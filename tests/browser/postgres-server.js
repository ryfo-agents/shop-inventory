/* Real production HTTP handlers + real isolated PostgreSQL. No fake auth/rows.
 * Opt in ONLY with BACKEND_TEST_DATABASE_URL pointing at disposable loopback PG.
 * Never reads DATABASE_URL as a connection target; never stops the parent PG.
 */
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TestDatabase } = require('../backend-db-fixture');
const root = path.resolve(__dirname, '../..');

async function startPostgresServer() {
  if (!process.env.BACKEND_TEST_DATABASE_URL) throw new Error('BACKEND_TEST_DATABASE_URL is required; no production database fallback');
  const target = new URL(process.env.BACKEND_TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.searchParams.has('host')) {
    throw new Error('Only explicit loopback PostgreSQL URLs without host overrides are allowed');
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-browser-pg-'));
  let pg, server, driverPath, driver;
  const originalDatabase = process.env.DATABASE_URL;
  const productionModules = () => Object.keys(require.cache).filter(file => file.startsWith(path.join(root, 'api') + path.sep) || file.startsWith(path.join(root, 'lib') + path.sep));
  const savedModules = new Map(productionModules().map(file => [file, require.cache[file]]));
  const requests = [];
  let delayNextMark = 0;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (server?.listening) await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    } finally {
      try {
        if (pg) await pg.close();
      } finally {
        if (driverPath && driver) require.cache[driverPath].exports = driver;
        productionModules().forEach(file => delete require.cache[file]);
        for (const [file, module] of savedModules) require.cache[file] = module;
        if (originalDatabase === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabase;
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }
  }
  try {
    pg = new TestDatabase();
    await pg.ready;
    // Only Neon transport is replaced. All SQL/migrations/auth/authorization/
    // password hashing/cookies/seed/version handling are shipped production code.
    const sql = (strings, ...values) => sql.query(strings.reduce((text, part, i) => text + (i ? '$' + i : '') + part, ''), values);
    sql.query = async (text, values) => (await pg.query(text, values)).rows;
    driverPath = require.resolve('@neondatabase/serverless');
    driver = require(driverPath);
    require.cache[driverPath].exports = { ...driver, neon: () => sql };
    productionModules().forEach(file => delete require.cache[file]);
    process.env.DATABASE_URL = 'postgresql://local-test-transport-only/not-used';
    await require('../../scripts/migrate').migrate(sql, { log: () => {} });
    const auth = Object.fromEntries(['register', 'password-login', 'password-logout', 'me'].map(name => [name, require('../../api/auth/' + name)]));
    const workspace = Object.fromEntries(['state', 'checklist', 'marks', 'marks/[itemId]'].map(name => [name, require('../../api/workspaces/[workspaceId]/' + name)]));
    const key = path.join(scratch, 'key.pem'), cert = path.join(scratch, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (req, res) => {
      const url = new URL(req.url, 'https://127.0.0.1');
      const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
      try {
        if (!url.pathname.startsWith('/api/')) {
          const asset = url.pathname === '/' ? 'index.html' : url.pathname === '/greenfield/' ? 'greenfield/index.html' : url.pathname.slice(1);
          if (!/^(index\.html|manifest\.webmanifest|sw\.js|greenfield\/[\w.-]+\.(js|css|html)|icons\/[\w.-]+\.png)$/.test(asset)) return json(404, { error: 'not_found' });
          const file = path.join(root, asset);
          if (!fs.existsSync(file)) return json(404, { error: 'not_found' });
          const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)];
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
          res.end(fs.readFileSync(file)); return;
        }
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 65536) return json(413, { error: 'too_large' }); }
        // Match Vercel's parsed JSON body and query routing, not handler behavior.
        req.body = raw ? JSON.parse(raw) : {};
        req.query = Object.fromEntries(url.searchParams);
        const authMatch = /^\/api\/auth\/([^/]+)$/.exec(url.pathname);
        const match = /^\/api\/workspaces\/([^/]+)\/(state|checklist|marks(?:\/([^/]+))?)$/.exec(url.pathname);
        let handler;
        if (authMatch) handler = auth[authMatch[1]];
        if (match) {
          req.query.workspaceId = decodeURIComponent(match[1]);
          if (match[3]) req.query.itemId = decodeURIComponent(match[3]);
          handler = workspace[match[3] ? 'marks/[itemId]' : match[2]];
        }
        if (!handler) return json(404, { error: 'not_found' });
        const record = { method: req.method, path: url.pathname, body: req.body };
        requests.push(record);
        res.status = status => { res.statusCode = status; return res; };
        res.json = body => { record.status = res.statusCode; record.result = body; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
        if (match?.[3] && ['PUT', 'PATCH'].includes(req.method) && delayNextMark) {
          const delay = delayNextMark; delayNextMark = 0;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        await handler(req, res);
      } catch (error) {
        // Do not turn integration defects into canned success responses.
        console.error('Real PostgreSQL browser server failed:', error.message);
        if (!res.headersSent) json(500, { error: 'integration_server_error' });
        else res.destroy();
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: 'https://127.0.0.1:' + server.address().port, pg, requests, delayNextMark(ms) { delayNextMark = ms; }, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { startPostgresServer };
