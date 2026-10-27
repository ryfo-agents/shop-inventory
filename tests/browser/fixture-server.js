/* IN-MEMORY QA FIXTURE, not production handlers/auth/PostgreSQL evidence. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function stateFor(account) {
  const name = account === 'alpha' ? 'Alpha' : 'Beta';
  return {
    sections: [{ id: account + '-section', num: 1, title: name + ' tools', sort_order: 0 }],
    subsections: [{ id: account + '-sub', section_id: account + '-section', num: '1.1', title: 'Hand tools', sort_order: 0 }],
    items: [{ id: account + '-item', subsection_id: account + '-sub', label: name + ' wrench', store: 'General', qty: false, sort_order: 0 }],
    marks: [{ item_id: account + '-item', status: 'unknown', q: 3, sp: 'Metric', n: name + ' private fixture note', c: 12.5, revision: 0, updated_at: new Date(0).toISOString() }]
  };
}
async function startFixture(port = 0) {
  const states = { alpha: stateFor('alpha'), beta: stateFor('beta') };
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (!url.pathname.startsWith('/api/')) {
        const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!/^(index\.html|manifest\.webmanifest|sw\.js|greenfield\/[\w.-]+\.(js|css|html)|icons\/[\w.-]+\.png)$/.test(asset)) return send(404, {});
        const file = path.join(root, asset);
        if (!fs.existsSync(file)) return send(404, {});
        const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file)); return;
      }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) return send(413, {}); }
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/api/auth/password-login' && req.method === 'POST') {
        const account = ['alpha', 'beta'].find(a => body.email === a + '@example.test');
        if (!account || body.password !== 'fixture-password-only') return send(401, { error: 'invalid_credentials' });
        const token = crypto.randomUUID(); sessions.set(token, account);
        res.setHeader('Set-Cookie', 'qa_fixture=' + token + '; Path=/; HttpOnly; SameSite=Lax');
        return send(200, { user: { id: account, email: body.email }, workspace: { id: account, name: account + ' fixture' } });
      }
      const token = /(?:^|;\s*)qa_fixture=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      const account = sessions.get(token);
      if (url.pathname === '/api/auth/password-logout') {
        sessions.delete(token); res.setHeader('Set-Cookie', 'qa_fixture=; Path=/; Max-Age=0'); return send(200, { ok: true });
      }
      if (!account) return send(401, { error: 'not_authenticated' });
      if (url.pathname === '/api/auth/me') return send(200, { user: { id: account, email: account + '@example.test' }, workspace: { id: account, name: account + ' fixture' } });
      const match = /^\/api\/workspaces\/([^/]+)\/(state|marks\/([^/]+))$/.exec(url.pathname);
      if (!match) return send(404, {});
      if (match[1] !== account) return send(403, { error: 'forbidden' });
      const state = states[account];
      if (match[2] === 'state' && req.method === 'GET') return send(200, state);
      if (match[3] && ['PUT', 'PATCH'].includes(req.method)) {
        const mark = state.marks.find(m => m.item_id === match[3]);
        if (!mark) return send(404, {});
        if (body.revision != null && body.revision !== mark.revision) return send(409, { error: 'stale_revision', mark });
        for (const field of ['status','q','sp','n','c']) if (Object.hasOwn(body, field)) mark[field] = body[field];
        mark.revision++; mark.updated_at = new Date().toISOString(); return send(200, { mark });
      }
      send(405, { error: 'method_not_allowed' });
    } catch (_) { send(400, { error: 'invalid_fixture_request' }); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { startFixture };
if (require.main === module) startFixture(Number(process.env.QA_PORT || 4173)).then(f => console.log('Local in-memory QA fixture: ' + f.url));
