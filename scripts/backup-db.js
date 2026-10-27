/* Manual operator tool. Never schedules jobs or loads deployment credentials. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function connection(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error('A PostgreSQL connection URL is required in the environment'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.pathname.slice(1)) throw new Error('Invalid PostgreSQL connection settings');
  // Only libpq TLS options we explicitly support; never pass the source URL onward.
  const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username) };
  for (const key of Object.keys(env)) if (/^(DATABASE_URL|RESTORE_DATABASE_URL|PGPASSWORD|PGSERVICE|PGSERVICEFILE|PGOPTIONS)$/.test(key)) delete env[key];
  env.PGSSLMODE = u.searchParams.get('sslmode') || (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? 'prefer' : 'verify-full');
  if (!['disable','allow','prefer','require','verify-ca','verify-full'].includes(env.PGSSLMODE)) throw new Error('Invalid sslmode');
  return { env, password: decodeURIComponent(u.password) };
}
function withConnection(raw, fn) {
  const config = connection(raw);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-pg-'));
  fs.chmodSync(dir, 0o700);
  const passfile = path.join(dir, 'pgpass');
  const escape = x => String(x).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  try {
    if (Object.values(config.env).some(x => /[\r\n]/.test(x)) || /[\r\n]/.test(config.password)) throw new Error('Newlines are not supported in connection settings');
    fs.writeFileSync(passfile, [config.env.PGHOST, config.env.PGPORT, config.env.PGDATABASE, config.env.PGUSER, config.password].map(escape).join(':') + '\n', { mode: 0o600 });
    fn({ ...config.env, PGPASSFILE: passfile });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Tool diagnostics may contain connection strings or row data. Do not echo them.
  if (result.error || result.status !== 0) throw new Error(command + ' failed; check tool availability, server compatibility and access (diagnostics withheld)');
}
function main() {
  process.umask(0o077);
  if (process.argv[2] === '--restore-rehearsal') {
    const raw = process.env.RESTORE_DATABASE_URL;
    const { env } = connection(raw);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(env.PGHOST) || !/^shop_restore_[a-z0-9_]+$/.test(env.PGDATABASE) || process.env.CONFIRM_DISPOSABLE_RESTORE !== 'yes') throw new Error('Restore requires loopback host, shop_restore_ disposable database and CONFIRM_DISPOSABLE_RESTORE=yes');
    const file = path.resolve(process.argv[3] || '');
    if (!fs.statSync(file).isFile()) throw new Error('Archive file required');
    withConnection(raw, e => {
      run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', e.PGDATABASE, file], e);
      run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', 'SELECT count(*) FROM information_schema.tables WHERE table_schema = \'public\';'], e);
    });
    console.log('Disposable restore completed; validate inventory, constraints and application behavior before release.');
    return;
  }
  const dir = path.resolve(process.argv[2] || 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'shop-inventory-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump');
  let created = false;
  try {
    fs.writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
    created = true;
    withConnection(process.env.DATABASE_URL, env => run('pg_dump', ['--no-password', '--format=custom', '--file', file], env));
    console.log(file);
  } catch (error) { if (created) fs.rmSync(file, { force: true }); throw error; }
}
try { main(); } catch (error) { console.error(error.message.includes('ENOENT') ? 'Archive or PostgreSQL tool unavailable' : error.message); process.exitCode = 1; }
