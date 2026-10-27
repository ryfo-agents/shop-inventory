const nodeTest = require('node:test');
const test = process.env.BACKEND_TEST_DATABASE_URL ? nodeTest : nodeTest.skip;
const assert = require('node:assert/strict');
// Requires test-only pg installed outside the application or by the test gate.
// BACKEND_TEST_DATABASE_URL must explicitly point to a disposable local server.
const { TestDatabase: TestDatabase } = require('./backend-db-fixture');
const { migrate } = require('../scripts/migrate');
const fs = require('node:fs');
const path = require('node:path');
async function fixture(pg) {
 await pg.exec(`INSERT INTO users(id,email) VALUES ('u1','one@example.test'),('u2','two@example.test');
 INSERT INTO workspaces(id,name,owner_id) VALUES ('w1','one','u1'),('w2','two','u2');
 INSERT INTO memberships(workspace_id,user_id,role) VALUES ('w1','u1','owner'),('w2','u2','owner');
 INSERT INTO sections(id,workspace_id,num,title,sort_order) VALUES ('s1','w1',1,'one',0),('s2','w2',2,'two',0);
 INSERT INTO subsections(id,workspace_id,section_id,num,title,sort_order) VALUES ('sub1','w1','s1','1','one',0),('sub2','w2','s2','2','two',0);
 INSERT INTO items(id,workspace_id,subsection_id,label,sort_order) VALUES ('i1','w1','sub1','one',0),('i2','w2','sub2','two',0);`);
}
async function oldDatabase(pg) {
 await pg.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
 for (const f of ['001_cloud_first.sql','002_cloud_first_repair.sql','003_inventory_tables.sql']) await pg.exec(fs.readFileSync(path.join(__dirname,'../db/migrations',f),'utf8'));
 await pg.exec(`CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now());
 INSERT INTO schema_migrations(version) VALUES ('001_cloud_first.sql'),('002_cloud_first_repair.sql'),('003_inventory_tables.sql');`);
}
function adapter(pg) { return { query: async (text,params=[]) => (await pg.query(text,params)).rows }; }
async function call(pg,name,args) {return (await pg.query(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;}
test('mark patches preserve omissions, allow explicit null, and reject stale or missing preconditions effect-free', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  const first=await call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status:'have',q:7,sp:'M8',n:'keep',c:12.5}])]);
  assert.equal(first.marks[0].version,1);
  const second=await call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:1,status:'missing'}])]);
  assert.equal(second.marks[0].q,7); assert.equal(second.marks[0].n,'keep'); assert.equal(second.marks[0].sp,'M8'); assert.equal(second.marks[0].c,12.5);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:1,status:'na'}])]), /revision_conflict/);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',status:'na'}])]), /precondition_required/);
  const third=await call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:2,q:null,sp:null,n:'',c:0,status:null}])]);
  assert.equal(third.marks[0].q,null); assert.equal(third.marks[0].sp,null); assert.equal(third.marks[0].n,''); assert.equal(third.marks[0].c,0); assert.equal(third.marks[0].status,null);
  assert.equal(third.revision,3);
  assert.equal((await pg.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,3);
 } finally {await pg.close();}
});
test('bulk mark validation, audit failures, tenant denial and archived denial roll back every effect', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status:'have'},{itemId:'i2',version:0,status:'have'}])]),/item_not_found/);
  await assert.rejects(call(pg,'shop_patch_marks',['w2','u1',JSON.stringify([{itemId:'i2',version:0,status:'have'}])]),/forbidden/);
  await pg.exec("UPDATE workspaces SET archived_at=now() WHERE id='w1'");
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status:'have'}])]),/forbidden/);
  await pg.exec("UPDATE workspaces SET archived_at=NULL WHERE id='w1'; CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit()");
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status:'have'}])]),/test audit failure/);
  assert.equal((await pg.query('SELECT count(*)::int n FROM marks')).rows[0].n,0);
  assert.equal((await pg.query("SELECT revision::int FROM workspaces WHERE id='w1'")).rows[0].revision,0);
  assert.equal((await pg.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,0);
 } finally {await pg.close();}
});
test('bootstrap repairs partial seeds atomically, is idempotent, and reads use an authorized consistent revision', async () => {
 const pg=new TestDatabase();
 const seed=JSON.stringify({sections:[{id:'s',num:1,title:'seed',sort_order:0}],subsections:[{id:'b',section_id:'s',num:'1',title:'seed',sort_order:0}],items:[{id:'i',subsection_id:'b',label:'seed',sort_order:0}]});
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  await pg.exec("INSERT INTO sections(id,workspace_id,num,title,sort_order) VALUES ('w1:s','w1',1,'custom',0)");
  const state=await call(pg,'shop_state',['w1','u1',seed]);
  assert.equal(state.sections.find(s=>s.id==='w1:s').title,'custom');
  assert.ok(state.items.some(i=>i.id==='w1:i'));
  assert.equal(state.revision,1);
  assert.equal((await call(pg,'shop_state',['w1','u1',seed])).revision,1);
  assert.equal((await pg.query("SELECT count(*)::int n FROM audit_events WHERE action='bootstrap'")).rows[0].n,1);
  await assert.rejects(call(pg,'shop_state',['w2','u1',seed]),/forbidden/);
  await pg.exec("UPDATE workspaces SET archived_at=now() WHERE id='w1'");
  await assert.rejects(call(pg,'shop_state',['w1','u1',null]),/forbidden/);
 } finally {await pg.close();}
});
test('bootstrap failure rolls back sections, marker, revision and audit', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  await assert.rejects(call(pg,'shop_state',['w1','u1',JSON.stringify({sections:[{id:'new',num:1,title:'new',sort_order:0}],subsections:[],items:[{id:'bad',subsection_id:'missing',label:'bad',sort_order:0}]})]),/foreign key/);
  assert.equal((await pg.query("SELECT count(*)::int n FROM sections WHERE id='w1:new'")).rows[0].n,0);
  assert.equal((await pg.query("SELECT bootstrapped_at,revision::int FROM workspaces WHERE id='w1'")).rows[0].revision,0);
  assert.equal((await pg.query("SELECT bootstrapped_at FROM workspaces WHERE id='w1'")).rows[0].bootstrapped_at,null);
 } finally {await pg.close();}
});
test('concurrent writers using one version have one commit and one conflict', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  const results=await Promise.allSettled(['have','missing'].map(status=>call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status}])])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/revision_conflict/);
  assert.equal((await pg.query("SELECT revision::int FROM workspaces WHERE id='w1'")).rows[0].revision,1);
 } finally {await pg.close();}
});
test('registration commits user/workspace/membership/session/audit together and duplicate registration is effect-free', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}});
  const args=['new-user','new@example.test','New user','test-password-hash','session-id','token-hash','2099-01-01'];
  const registered=await call(pg,'shop_register',args);
  assert.equal(registered.user.id,'new-user'); assert.equal(registered.workspace.role,'owner');
  const same=await call(pg,'shop_provision',['new-user']);
  assert.equal(same.id,registered.workspace.id);
  await assert.rejects(call(pg,'shop_register',args),e=>e.code==='23505');
  assert.equal((await pg.query('SELECT count(*)::int n FROM sessions')).rows[0].n,1);
  await pg.exec("CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test session failure'; END $$; CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session()");
  await assert.rejects(call(pg,'shop_register',['other','other@example.test','Other','hash','other-session','other-token','2099-01-01']),/test session failure/);
  assert.equal((await pg.query("SELECT count(*)::int n FROM users WHERE id='other'")).rows[0].n,0);
  assert.equal((await pg.query('SELECT count(*)::int n FROM workspaces')).rows[0].n,1);
  assert.equal((await pg.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,1);
 } finally {await pg.close();}
});
test('concurrent migration runners and provisioning remain idempotent',async()=>{
 const pg=new TestDatabase();
 try {
  await Promise.all([migrate(adapter(pg),{log:()=>{}}),migrate(adapter(pg),{log:()=>{}})]);
  assert.equal((await pg.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,5);
  await pg.exec("INSERT INTO users(id,email) VALUES ('new','new@example.test')");
  const workspaces=await Promise.all([call(pg,'shop_provision',['new']),call(pg,'shop_provision',['new'])]);
  assert.equal(workspaces[0].id,workspaces[1].id);
  assert.equal((await pg.query('SELECT count(*)::int n FROM workspaces')).rows[0].n,1);
  assert.equal((await pg.query('SELECT count(*)::int n FROM memberships')).rows[0].n,1);
  assert.equal((await pg.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,1);
 } finally {await pg.close();}
});
test('snapshot waits for an in-flight writer and returns matching marks and revision',async()=>{
 const pg=new TestDatabase(); let writer;
 try {
  await migrate(adapter(pg),{log:()=>{}});await fixture(pg);
  writer=await pg.pool.connect();
  await writer.query('BEGIN');
  await writer.query('SELECT shop_patch_marks($1,$2,$3::jsonb)',['w1','u1',JSON.stringify([{itemId:'i1',version:0,status:'missing'}])]);
  let resolved=false;
  const pending=call(pg,'shop_state',['w1','u1',null]).then(result=>{resolved=true;return result;});
  await new Promise(r=>setTimeout(r,30));assert.equal(resolved,false);
  await writer.query('COMMIT');
  const snapshot=await pending;
  assert.equal(snapshot.revision,1);assert.equal(snapshot.marks[0].status,'missing');assert.equal(snapshot.marks[0].version,1);
 } finally {if(writer){await writer.query('ROLLBACK');writer.release();}await pg.close();}
});
test('bulk validates duplicates and bounds and commits multiple marks under one revision',async()=>{
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}});await fixture(pg);
  await pg.exec("INSERT INTO items(id,workspace_id,subsection_id,label,sort_order) VALUES ('i3','w1','sub1','three',1)");
  const patches=[{itemId:'i1',version:0,status:'have'},{itemId:'i3',version:0,status:'na'}];
  const saved=await call(pg,'shop_patch_marks',['w1','u1',JSON.stringify(patches)]);
  assert.equal(saved.marks.length,2);assert.equal(saved.revision,1);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:1,status:'missing'},{itemId:'i1',version:1,status:'have'}])]),/invalid_marks/);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1','[]']),/invalid_marks/);
  await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify(Array.from({length:101},(_,i)=>({itemId:'fake'+i,version:0,status:'have'})))]),/invalid_marks/);
  for(const fields of [{q:-1},{c:-1},{n:{}},{status:'bad'},{version:null,status:'have'},{q:0.5},{q:'1'},{sp:1},{q:2147483648},{c:1000000001},{status:'have',extra:true}]){
   await assert.rejects(call(pg,'shop_patch_marks',['w1','u1',JSON.stringify([{itemId:'i1',version:1,...fields}])]),/invalid_/);
  }
  assert.equal((await pg.query("SELECT revision::int FROM workspaces WHERE id='w1'")).rows[0].revision,1);
 } finally {await pg.close();}
});
test('repair handles recorded 001 with missing ownership tables and columns',async()=>{
 const pg=new TestDatabase();
 try {
  await pg.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
  await pg.exec("CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now()); INSERT INTO schema_migrations(version) VALUES ('001_cloud_first.sql')");
  await migrate(adapter(pg),{log:()=>{}});
  await fixture(pg);
  assert.equal((await pg.query("SELECT count(*)::int n FROM workspaces")).rows[0].n,2);
 } finally {await pg.close();}
});
test('fresh migrations are atomic, ordered, and idempotent', async () => {
 const pg = new TestDatabase();
 try {
  await migrate(adapter(pg), {log:()=>{}});
  await migrate(adapter(pg), {log:()=>{}});
  assert.equal((await pg.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,5);
  assert.equal((await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name='marks' AND column_name='version'")).rows.length,1);
 } finally { await pg.close(); }
});
test('tenant parent FKs reject cross-tenant children and mark slots', async () => {
 const pg=new TestDatabase();
 try {
  await migrate(adapter(pg),{log:()=>{}}); await fixture(pg);
  await assert.rejects(pg.exec("INSERT INTO subsections(id,workspace_id,section_id,num,title,sort_order) VALUES ('bad','w1','s2','1','bad',0)"));
  await assert.rejects(pg.exec("UPDATE items SET subsection_id='sub2' WHERE id='i1'"));
  await assert.rejects(pg.exec("INSERT INTO marks(item_id,workspace_id,status) VALUES ('i2','w1','have')"));
  await assert.rejects(pg.exec("INSERT INTO marks(item_id,workspace_id,q) VALUES ('i1','w1',-1)"));
 } finally {await pg.close();}
});
test('upgrade quarantines unowned legacy roots and inherits parent ownership without inventing user access', async () => {
 const pg=new TestDatabase();
 try {
  await oldDatabase(pg); await fixture(pg);
  await pg.exec("INSERT INTO marks(item_id,q,n) VALUES ('i1',7,'keep'); INSERT INTO sections(id,num,title,sort_order) VALUES ('orphan',9,'legacy',0)");
  await migrate(adapter(pg),{log:()=>{}});
  assert.equal((await pg.query("SELECT workspace_id,q,n FROM marks WHERE item_id='i1'")).rows[0].workspace_id,'w1');
  const row=(await pg.query("SELECT w.archived_at,u.disabled_at FROM sections s JOIN workspaces w ON s.workspace_id=w.id JOIN users u ON u.id=w.owner_id WHERE s.id='orphan'")).rows[0];
  assert.ok(row.archived_at); assert.ok(row.disabled_at);
  await assert.rejects(pg.exec("INSERT INTO marks(item_id,workspace_id,q) VALUES ('i2','w2',-1)"));
 } finally {await pg.close();}
});
test('upgrade quarantine never reuses or disables an existing legacy-quarantine email account', async () => {
 const pg=new TestDatabase();
 try {
  await oldDatabase(pg); await fixture(pg);
  await pg.exec("UPDATE users SET email='legacy-quarantine@invalid.local',display_name='Real account',password_hash='preserve-password' WHERE id='u1'; INSERT INTO sections(id,num,title,sort_order) VALUES ('orphan',9,'legacy',0)");
  const accountBefore=(await pg.query("SELECT * FROM users WHERE id='u1'")).rows[0];
  const membershipsBefore=(await pg.query("SELECT * FROM memberships WHERE user_id='u1'")).rows;
  await migrate(adapter(pg),{log:()=>{}});
  await migrate(adapter(pg),{log:()=>{}});
  assert.deepEqual((await pg.query("SELECT * FROM users WHERE id='u1'")).rows[0],accountBefore);
  assert.deepEqual((await pg.query("SELECT * FROM memberships WHERE user_id='u1'")).rows,membershipsBefore);
  const quarantine=(await pg.query("SELECT w.id,w.archived_at,u.id owner_id,u.email,u.disabled_at,u.password_hash FROM sections s JOIN workspaces w ON w.id=s.workspace_id JOIN users u ON u.id=w.owner_id WHERE s.id='orphan'")).rows[0];
  assert.notEqual(quarantine.owner_id,'u1');
  assert.notEqual(quarantine.email,accountBefore.email);
  assert.match(quarantine.email,/@invalid\.local$/);
  assert.ok(quarantine.disabled_at); assert.ok(quarantine.archived_at);
  assert.equal(quarantine.password_hash,null);
  assert.equal((await pg.query('SELECT count(*)::int n FROM memberships WHERE workspace_id=$1 OR user_id=$2',[quarantine.id,quarantine.owner_id])).rows[0].n,0);
  assert.equal((await pg.query('SELECT count(*)::int n FROM users')).rows[0].n,3);
  assert.equal((await pg.query("SELECT workspace_id FROM sections WHERE id='s1'")).rows[0].workspace_id,'w1');
 } finally {await pg.close();}
});
test('inconsistent upgrade fails atomically without migration record or backfill', async () => {
 const pg=new TestDatabase();
 try {
  await oldDatabase(pg); await fixture(pg);
  await pg.exec("UPDATE items SET workspace_id='w2' WHERE id='i1'");
  await assert.rejects(migrate(adapter(pg),{log:()=>{}}));
  assert.equal((await pg.query("SELECT count(*)::int n FROM schema_migrations WHERE version='004_backend_safety.sql'")).rows[0].n,0);
  assert.equal((await pg.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='marks' AND column_name='version'")).rows[0].n,0);
 } finally {await pg.close();}
});
