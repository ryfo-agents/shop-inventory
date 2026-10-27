const { db, normalizeEmail, verifyPassword, createSession } = require('../../lib/cloud-auth');
const { allow, clientKey } = require('../../lib/rate-limit');

const { parseBody } = require('../../lib/workspace-api');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!allow(clientKey(req, 'login'), 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'too_many_requests' });
  let input;
  try { input = parseBody(req); } catch (_) { return res.status(400).json({error:'invalid_body'}); }
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (email.length > 254 || password.length > 1024) return res.status(400).json({error:'invalid_credentials'});
  try {
    const rows = await db()`SELECT id, email, display_name, password_hash FROM users WHERE email = ${email} AND disabled_at IS NULL`;
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const user = { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name };
    const workspace = await createSession(res, user.id);
    res.status(200).json({ user, workspace });
  } catch (err) {
    // Do not log database errors containing private row data.
    res.status(500).json({ error: 'login_failed' });
  }
};
