const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

// Preserve applied 001-003 byte-for-byte. New migration 000 provides the
// explicit fresh/partially-recorded compatibility prerequisite for 001/003.
// A single server-side DO statement is an implicit PostgreSQL transaction:
// SQL + version recording either both commit or neither does. Do not split SQL
// on semicolons: functions, strings and comments can contain them.
async function migrate(sql, { log = console.log, dir = path.join(__dirname, '..', 'db', 'migrations') } = {}) {
  await sql.query(`DO $runner$ BEGIN
    PERFORM pg_advisory_xact_lock(73462519);
    CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
  END $runner$;`);
  for (const file of fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    if (text.includes('$runner$')) throw new Error('Reserved migration delimiter');
    // File names are constrained above; still quote SQL literals explicitly.
    const version = "'" + file.replaceAll("'", "''") + "'";
    await sql.query(`DO $runner$ BEGIN
      PERFORM pg_advisory_xact_lock(73462519);
      IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ${version}) THEN
        ${text}
        INSERT INTO schema_migrations(version) VALUES (${version});
      END IF;
    END $runner$;`);
    log('verified', file);
  }
}
if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exitCode = 1; }
  else Promise.resolve().then(() => migrate(neon(process.env.DATABASE_URL))).catch(() => {
    // Database errors can contain row values and credentials: keep CLI safe.
    console.error('Migration failed; transaction rolled back. Inspect the database privately.');
    process.exitCode = 1;
  });
}
module.exports = { migrate };
