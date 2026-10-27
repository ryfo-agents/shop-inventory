const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('backup collision cannot remove or overwrite an existing archive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-backup-collision-'));
  try {
    const preload = path.join(dir, 'clock.js');
    fs.writeFileSync(preload, "global.Date = class extends Date { constructor() { super('2026-01-01T00:00:00.000Z'); } };\n");
    const existing = path.join(dir, 'shop-inventory-2026-01-01T00-00-00-000Z.dump');
    fs.writeFileSync(existing, 'existing private archive');
    const r = spawnSync(process.execPath, ['--require', preload, path.resolve('scripts/backup-db.js'), dir], { env: { ...process.env, DATABASE_URL: 'postgres://fixture@127.0.0.1/shop_restore_test' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.ok(fs.existsSync(existing), 'collision must preserve existing archive');
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing private archive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
