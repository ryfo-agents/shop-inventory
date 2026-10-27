const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('invalid connection settings leave no temporary credential directory or partial archive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-credential-cleanup-'));
  const output = path.join(dir, 'archives');
  try {
    const r = spawnSync(process.execPath, [path.resolve('scripts/backup-db.js'), output], { env: { ...process.env, TMPDIR: dir, DATABASE_URL: 'postgres://fixture:bad%0Apassword@127.0.0.1/shop_restore_test' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.deepEqual(fs.readdirSync(dir), ['archives']);
    assert.deepEqual(fs.readdirSync(output), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
