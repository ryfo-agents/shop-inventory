const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
test('database release gate rejects missing opt-in rather than reporting skipped tests as success',()=>{
 const env={...process.env};delete env.BACKEND_TEST_DATABASE_URL;
 const result=spawnSync(process.execPath,['scripts/test-database.js'],{env,encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/BACKEND_TEST_DATABASE_URL is required/);
});
