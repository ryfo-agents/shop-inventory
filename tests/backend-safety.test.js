const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function response() { return { headers: {}, code: 200, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; } }; }
for (const route of ['../api/auth/login', '../api/auth/logout', '../api/sync']) {
  test(`legacy ${route} fails closed before reading any credentials`, async () => {
    const res=response();
    await require(route)({method:'POST',headers:{},body:{}},res);
    assert.equal(res.code,410);
    assert.equal(res.body.error,'legacy_api_disabled');
    assert.equal(res.headers['Cache-Control'],'no-store');
    assert.equal(res.headers['Set-Cookie'],undefined);
  });
}
test('old signed sessions cannot authorize even with configured secret', () => {
  process.env.SESSION_SECRET='unit-test-only';
  const exp=String(Date.now()+100000);
  const token=exp+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(exp).digest('hex');
  assert.equal(require('../lib/auth').requireSession({headers:{cookie:'shop_session='+token}}),false);
  delete process.env.SESSION_SECRET;
});
for (const helper of ['getChangedSince','upsertSections','upsertSubsections','upsertItems','upsertMarks']) {
  test(`legacy database helper ${helper} is disabled`,async()=>{
    await assert.rejects(require('../lib/db')[helper]([]),/legacy_api_disabled/);
  });
}
test('malformed password hashes never authenticate or throw',()=>{
 const {verifyPassword}=require('../lib/cloud-auth');
 for(const hash of ['salt:zz','salt:','no-colon',null,'abc:'+ 'ab'.repeat(64)]) assert.equal(verifyPassword('not-the-password',hash),false);
});
test('migration CLI reports configuration failures without raw errors or values',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['scripts/migrate.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,DATABASE_URL:'invalid-secret-sentinel'},encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Migration failed; transaction rolled back/);
 assert.doesNotMatch(result.stderr,/invalid-secret-sentinel|at neon|index.js/);
});
module.exports={response};
