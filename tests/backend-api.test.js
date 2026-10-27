const nodeTest=require('node:test');
const test=process.env.BACKEND_TEST_DATABASE_URL?nodeTest:nodeTest.skip;
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {TestDatabase}=require('./backend-db-fixture');
const {migrate}=require('../scripts/migrate');
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};}
// Only the transport is adapted: handlers, sessions, authorization and every
// SQL statement execute against real, isolated PostgreSQL (no canned DB rows).
function localTransport(pg){
 const sql=(strings,...values)=>sql.query(strings.reduce((s,v,i)=>s+(i?'$'+i:'')+v,''),values);
 sql.query=async(text,params)=>(await pg.query(text,params)).rows;
 return sql;
}
test('actual handlers against isolated PostgreSQL',async t=>{
 const pg=new TestDatabase(); const sql=localTransport(pg);
 const driverPath=require.resolve('@neondatabase/serverless');
 const driver=require(driverPath);
 require.cache[driverPath].exports={...driver,neon:()=>sql};
 process.env.DATABASE_URL='postgresql://local-test-transport-only/not-used';
 const authPath=require.resolve('../lib/cloud-auth'); delete require.cache[authPath];
 try{
  await migrate(sql,{log:()=>{}});
  const token=crypto.randomBytes(32).toString('hex');
  await pg.query("SELECT shop_register($1,$2,$3,$4,$5,$6,$7)",['u1','one@example.test','One','hash','sess1',crypto.createHash('sha256').update(token).digest('hex'),'2099-01-01']);
  const workspace=(await pg.query("SELECT id FROM workspaces WHERE owner_id='u1'")).rows[0].id;
  const req=(method,body={},extra={})=>({method,body,headers:{cookie:'shop_session='+token},query:{workspaceId:workspace,itemId:workspace+':fixture-item'},...extra});
  async function run(route,request){const res=response();await require('../api/'+route)(request,res);return res;}
  await t.test('health is uncached and never logs raw connection errors',async()=>{
   const ok=await run('health',req('GET'));assert.equal(ok.code,200);assert.equal(ok.headers['Cache-Control'],'no-store');
   const originalQuery=sql.query,originalLog=console.error;let logged=false;
   sql.query=async()=>{throw new Error('sensitive-fixture-sentinel');};console.error=()=>{logged=true;};
   try {const failed=await run('health',req('GET'));assert.equal(failed.code,503);assert.equal(logged,false);}
   finally {sql.query=originalQuery;console.error=originalLog;}
  });
  await t.test('registration failure cannot leave an account/workspace or set a session cookie',async()=>{
   await pg.exec("CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test session failure'; END $$; CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session()");
   const res=await run('auth/register',req('POST',{email:'failure@example.test',password:'isolated-test-password',displayName:'Failure'}));
   assert.equal(res.code,500);assert.equal(res.headers['Set-Cookie'],undefined);
   assert.equal((await pg.query("SELECT count(*)::int n FROM users WHERE email='failure@example.test'")).rows[0].n,0);
   await pg.exec('DROP TRIGGER reject_session ON sessions; DROP FUNCTION reject_session()');
  });
  await t.test('auth routes are no-store and registration/login/logout sessions persist',async()=>{
   const registered=await run('auth/register',req('POST',{email:'registered@example.test',password:'isolated-test-password',displayName:'Registered'}));
   assert.equal(registered.code,201);assert.equal(registered.headers['Cache-Control'],'no-store');assert.ok(registered.headers['Set-Cookie']);
   const sessionCookie=registered.headers['Set-Cookie'].split(';')[0];
   const me=await run('auth/me',req('GET',{}, {headers:{cookie:sessionCookie}}));
   assert.equal(me.code,200);assert.equal(me.headers['Cache-Control'],'no-store');
   const loggedIn=await run('auth/password-login',req('POST',{email:'registered@example.test',password:'isolated-test-password'}));
   assert.equal(loggedIn.code,200);assert.equal(loggedIn.body.workspace.id,registered.body.workspace.id);assert.equal(loggedIn.headers['Cache-Control'],'no-store');
   const loggedOut=await run('auth/password-logout',req('POST',{}, {headers:{cookie:sessionCookie}}));
   assert.equal(loggedOut.code,200);assert.equal(loggedOut.headers['Cache-Control'],'no-store');
   assert.equal((await run('auth/me',req('GET',{}, {headers:{cookie:sessionCookie}}))).code,401);
  });
  await t.test('auth rejects malformed input without unhandled exceptions or effects',async()=>{
   for(const body of [null,[], '{']) {
    assert.equal((await run('auth/password-login',req('POST',body))).code,400);
    assert.equal((await run('auth/register',req('POST',body))).code,400);
   }
  });
  await t.test('unsupported snapshot mutation/methods have no bootstrap effects',async()=>{
   for(const method of ['PUT','POST','DELETE']){
    const res=await run('workspaces/[workspaceId]/state',req(method,{sections:[],subsections:[],items:[],marks:[]}));
    assert.equal(res.code,405); assert.equal(res.headers['Cache-Control'],'no-store');
   }
   assert.equal((await pg.query('SELECT count(*)::int n FROM sections')).rows[0].n,0);
  });
  await t.test('state bootstraps full real seed once; checklist returns same revision and no private caching',async()=>{
   const res=await run('workspaces/[workspaceId]/state',req('GET'));
   assert.equal(res.code,200); assert.equal(res.headers['Cache-Control'],'no-store');
   assert.equal(res.body.items.length,1534); assert.equal(res.body.sections.length,19); assert.equal(res.body.subsections.length,100);
   assert.equal(res.body.revision,1);
   const again=await run('workspaces/[workspaceId]/state',req('GET'));assert.equal(again.body.revision,1);
   const read=await run('workspaces/[workspaceId]/checklist',req('GET'));assert.equal(read.body.revision,1);
  });
  await pg.query("INSERT INTO items(id,workspace_id,subsection_id,label,sort_order) SELECT $1,$2,id,'Fixture',0 FROM subsections WHERE workspace_id=$2 LIMIT 1",[workspace+':fixture-item',workspace]);
  await t.test('mark handler requires precondition and preserves nullable metadata',async()=>{
   const route='workspaces/[workspaceId]/marks/[itemId]';
   assert.equal((await run(route,req('PUT',{status:'have'}))).code,428);
   const first=await run(route,req('PUT',{version:0,status:'have',q:5,sp:'spec',n:'note',c:7}));
   assert.equal(first.code,200); assert.equal(first.body.mark.version,1);
   const second=await run(route,req('PATCH',{version:1,status:'missing'}));
   assert.equal(second.code,200); assert.equal(second.body.mark.n,'note');assert.equal(second.body.mark.q,5);
   const stale=await run(route,req('PUT',{version:1,status:'na'})); assert.equal(stale.code,409);
   const clear=await run(route,req('PUT',{version:2,n:null,q:null,c:0,sp:''}));
   assert.equal(clear.code,200);assert.equal(clear.body.mark.n,null);assert.equal(clear.body.mark.sp,'');
   for(const body of ['{',[],null,{version:3,q:1.2},{version:3,c:Infinity},{version:3,n:{}},{version:3,status:'bogus'},{version:3,status:'have',surprise:1}]) {
    const denied=await run(route,req('PUT',body));assert.equal(denied.code,400);
   }
  });
  await t.test('bounded bulk returns one revision and is all-or-nothing',async()=>{
   const route='workspaces/[workspaceId]/marks';
   const first=await run(route,req('POST',{marks:[{itemId:workspace+':fixture-item',version:3,status:'have'}]}));
   assert.equal(first.code,200);assert.equal(first.body.marks[0].version,4);
   const bad=await run(route,req('POST',{marks:[{itemId:workspace+':fixture-item',version:4,status:'na'},{itemId:'foreign-item',version:0,status:'have'}]}));
   assert.equal(bad.code,404);
   const tooMany=await run(route,req('POST',{marks:Array.from({length:101},(_,i)=>({itemId:'item'+i,version:0,status:'have'}))}));assert.equal(tooMany.code,400);
   assert.equal((await pg.query('SELECT version::int FROM marks WHERE item_id=$1',[workspace+':fixture-item'])).rows[0].version,4);
  });
  await t.test('cross-account reads/writes and references cannot see or occupy real foreign rows',async()=>{
   const foreignWorkspace=(await pg.query("SELECT w.id,u.id actor FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE u.email='registered@example.test'")).rows[0];
   const foreignState=(await pg.query('SELECT shop_state($1,$2,$3::jsonb) state',[foreignWorkspace.id,foreignWorkspace.actor,JSON.stringify({sections:[{id:'s',num:1,title:'foreign',sort_order:0}],subsections:[{id:'b',section_id:'s',num:'1',title:'foreign',sort_order:0}],items:[{id:'i',subsection_id:'b',label:'foreign',sort_order:0}]})])).rows[0].state;
   const foreignItem=foreignState.items[0].id;
   for(const route of ['workspaces/[workspaceId]/state','workspaces/[workspaceId]/checklist']) {
    assert.equal((await run(route,req('GET',{}, {query:{workspaceId:foreignWorkspace.id}}))).code,403);
    const own=await run(route,req('GET'));assert.ok(!own.body.items.some(i=>i.id===foreignItem));
   }
   const crossMark=await run('workspaces/[workspaceId]/marks/[itemId]',req('PUT',{version:0,status:'have'}, {query:{workspaceId:workspace,itemId:foreignItem}}));assert.equal(crossMark.code,404);
   const foreignWrite=await run('workspaces/[workspaceId]/marks/[itemId]',req('PUT',{version:0,status:'have'}, {query:{workspaceId:foreignWorkspace.id,itemId:foreignItem}}));assert.equal(foreignWrite.code,403);
   const crossBulk=await run('workspaces/[workspaceId]/marks',req('POST',{marks:[{itemId:foreignItem,version:0,status:'have'}]}));assert.equal(crossBulk.code,404);
   assert.equal((await pg.query('SELECT count(*)::int n FROM marks WHERE item_id=$1',[foreignItem])).rows[0].n,0);
  });
  await t.test('all workspace endpoints deny archived, foreign and revoked access; malformed or missing sessions return 401',async()=>{
   const routes=[['workspaces/[workspaceId]/state','GET'],['workspaces/[workspaceId]/checklist','GET'],['workspaces/[workspaceId]/marks/[itemId]','PUT'],['workspaces/[workspaceId]/marks','POST']];
   for(const [route,method] of routes){
    assert.equal((await run(route,req(method,{}, {headers:{}}))).code,401);
    assert.equal((await run(route,req(method,{}, {headers:{cookie:'shop_session=%ZZ'}}))).code,401);
    assert.equal((await run(route,req(method,{}, {query:{workspaceId:'foreign',itemId:'foreign'}}))).code,403);
   }
   await pg.query('UPDATE workspaces SET archived_at=now() WHERE id=$1',[workspace]);
   for(const [route,method] of routes) assert.equal((await run(route,req(method))).code,403);
   await pg.query('UPDATE workspaces SET archived_at=NULL WHERE id=$1',[workspace]);
   await pg.query("UPDATE memberships SET revoked_at=now() WHERE user_id='u1'");
   for(const [route,method] of routes) assert.equal((await run(route,req(method))).code,403);
  });
 } finally {require.cache[driverPath].exports=driver;delete process.env.DATABASE_URL;delete require.cache[authPath];await pg.close();}
});
