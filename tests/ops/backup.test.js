const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve('scripts/backup-db.js');

test('backup keeps credentials out of argv/output, uses private files and removes partial dumps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-backup-test-'));
  try {
    const tool = path.join(dir, 'pg_dump');
    fs.writeFileSync(tool, `#!/usr/bin/env node
const fs=require('fs');
if(process.argv.some(x=>x.includes('secret-test'))) process.exit(20);
const pass=fs.readFileSync(process.env.PGPASSFILE,'utf8');
if(!pass.includes('secret-test') || (fs.statSync(process.env.PGPASSFILE).mode & 63)) process.exit(21);
const file=process.argv[process.argv.indexOf('--file')+1];
fs.writeFileSync(file,'fixture archive');
if(process.env.FAIL_DUMP) { console.error('secret-test'); process.exit(2); }
`, { mode: 0o700 });
    const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH, DATABASE_URL: 'postgres://fixture:secret-test@127.0.0.1:5432/shop_restore_test' };
    const output = path.join(dir, 'output');
    let r = spawnSync(process.execPath, [script, output], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('secret-test') && !r.stderr.includes('secret-test'));
    const files = fs.readdirSync(output);
    assert.equal(files.length, 1);
    assert.equal(fs.statSync(path.join(output, files[0])).mode & 0o077, 0);
    r = spawnSync(process.execPath, [script, output], { env: { ...env, FAIL_DUMP: '1' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.ok(!r.stderr.includes('secret-test'));
    assert.equal(fs.readdirSync(output).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restore rehearsal refuses remote and non-disposable targets before invoking tools', () => {
  for (const target of ['postgres://fixture@remote.invalid/shop_restore_test', 'postgres://fixture@127.0.0.1/live']) {
    const r = spawnSync(process.execPath, [script, '--restore-rehearsal', 'missing.dump'], { env: { ...process.env, RESTORE_DATABASE_URL: target, CONFIRM_DISPOSABLE_RESTORE: 'yes' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /loopback.*shop_restore_/);
  }
});
