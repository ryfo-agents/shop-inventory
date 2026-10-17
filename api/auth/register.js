const { db, normalizeEmail, hashPassword, ensureDefaultWorkspace, createSession } = require('../../lib/cloud-auth');
const { allow, clientKey } = require('../../lib/rate-limit');

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!allow(clientKey(req, 'register'), 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'too_many_requests' });
  const input = body(req);
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const displayName = String(input.displayName || '').trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }
  try {
    const existing = await db()`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return res.status(409).json({ error: 'account_exists' });
    const userId = require('crypto').randomUUID();
    const rows = await db()`INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${userId}, ${email}, ${displayName}, ${hashPassword(password)})
      RETURNING id, email, display_name`;
    const workspace = await ensureDefaultWorkspace(rows[0]);
    await createSession(res, userId);
    res.status(201).json({ user: rows[0], workspace });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'registration_failed' });
  }
};
