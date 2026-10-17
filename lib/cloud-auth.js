const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const COOKIE = 'shop_session';
const SESSION_DAYS = 30;
let client;
function db() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !String(password)) return false;
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const expected = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(String(password), parts[0], expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

async function createSession(res, userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db()`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (${id}, ${userId}, ${hash}, ${expires})`;
  setCookie(res, raw, SESSION_DAYS * 86400);
}

async function currentUser(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const rows = await db()`SELECT u.id, u.email, u.display_name, s.id AS session_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`;
  return rows[0] || null;
}

async function revokeSession(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (raw) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await db()`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hash} AND revoked_at IS NULL`;
  }
  setCookie(res, '', 0);
}

async function workspaceForUser(userId) {
  const rows = await db()`SELECT w.id, w.name, m.role
    FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${userId} AND m.revoked_at IS NULL AND w.archived_at IS NULL
    ORDER BY w.created_at LIMIT 1`;
  return rows[0] || null;
}

async function ensureDefaultWorkspace(user) {
  const existing = await workspaceForUser(user.id);
  if (existing) return existing;
  const workspaceId = crypto.randomUUID();
  await db()`INSERT INTO workspaces (id, name, owner_id) VALUES (${workspaceId}, ${user.display_name || 'My shop'})`;
  await db()`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${user.id}, 'owner')`;
  return { id: workspaceId, name: user.display_name || 'My shop', role: 'owner' };
}

module.exports = {
  db, normalizeEmail, hashPassword, verifyPassword, currentUser,
  createSession, revokeSession, workspaceForUser, ensureDefaultWorkspace,
};
