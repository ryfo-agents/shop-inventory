const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const dir = process.argv[2] || path.join(process.cwd(), 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'shop-inventory-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump');
const result = spawnSync('pg_dump', ['--format=custom', '--file', file, process.env.DATABASE_URL], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(file);
