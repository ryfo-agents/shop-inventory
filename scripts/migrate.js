const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = await sql`SELECT version FROM schema_migrations`;
  const done = new Set(applied.map(r => r.version));
  for (const file of files) {
    if (done.has(file)) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = text.split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await sql.unsafe(statement);
    await sql`INSERT INTO schema_migrations (version) VALUES (${file})`;
    console.log('applied', file);
  }
  console.log('migrations complete');
}

main().catch(err => { console.error(err.message); process.exit(1); });
