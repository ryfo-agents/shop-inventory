const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directories = ['greenfield', 'api', 'lib', 'scripts', 'tests'];
function check(file) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.js')) check(file);
  }
}
for (const dir of directories) walk(dir);
check('sw.js'); check('playwright.config.js');
console.log('Syntax checks passed (shipped client, API, worker, scripts and test harnesses).');
