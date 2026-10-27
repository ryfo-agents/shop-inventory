const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('restore rehearsal invokes fail-fast transactional restore and readback using fixture tools only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-restore-contract-'));
  try {
    const archive = path.join(dir, 'fixture.dump'); fs.writeFileSync(archive, 'not a real archive');
    const log = path.join(dir, 'calls.jsonl');
    for (const tool of ['pg_restore', 'psql']) fs.writeFileSync(path.join(dir, tool), `#!/usr/bin/env node
const fs=require('fs');
if(!process.env.PGPASSFILE || process.env.DATABASE_URL || process.env.RESTORE_DATABASE_URL) process.exit(20);
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({tool:'${tool}',args:process.argv.slice(2),passfile:process.env.PGPASSFILE})+'\\n');
`, { mode: 0o700 });
    const r = spawnSync(process.execPath, [path.resolve('scripts/backup-db.js'), '--restore-rehearsal', archive], { env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, CALL_LOG: log, RESTORE_DATABASE_URL: 'postgres://fixture:fixture-only@127.0.0.1/shop_restore_contract', CONFIRM_DISPOSABLE_RESTORE: 'yes' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c => c.tool), ['pg_restore', 'psql']);
    assert.ok(calls[0].args.includes('--single-transaction'));
    assert.ok(calls[0].args.includes('--exit-on-error'));
    assert.ok(!calls[0].args.includes('--clean'));
    assert.ok(calls[1].args.includes('ON_ERROR_STOP=1'));
    assert.ok(calls.every(c => !fs.existsSync(c.passfile)));
    assert.ok(!JSON.stringify(calls).includes('fixture-only'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
