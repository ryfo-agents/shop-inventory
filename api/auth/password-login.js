const { db, normalizeEmail, verifyPassword, ensureDefaultWorkspace, createSession } = require('../../lib/cloud-auth');
const { allow, clientKey } = require('../../lib/rate-limit');

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!allow(clientKey(req, 'login'), 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'too_many_requests' });
  const input = body(req);
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  try {
    const rows = await db()`SELECT id, email, display_name, password_hash FROM users WHERE email = ${email} AND disabled_at IS NULL`;
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const user = { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name };
    const workspace = await ensureDefaultWorkspace(user);
    await createSession(res, user.id);
    res.status(200).json({ user, workspace });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'login_failed' });
  }
};
