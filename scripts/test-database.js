// Explicit database gate: missing opt-in is a failure, never a green skipped run.
const {spawnSync}=require('node:child_process');
if(!process.env.BACKEND_TEST_DATABASE_URL){
 console.error('BACKEND_TEST_DATABASE_URL is required (disposable loopback PostgreSQL only).');
 process.exit(1);
}
const args=process.argv.includes('--browser')
 ? [require.resolve('@playwright/test/cli'),'test','--config','playwright.postgres.config.js']
 : ['--test','tests/backend-safety.test.js','tests/backend-database.test.js','tests/backend-api.test.js'];
const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
if(result.error){console.error('Could not start database test runner.');process.exit(1);}
process.exit(result.status===null?1:result.status);
