const crypto = require('crypto');
const { currentUser, db } = require('../../../lib/cloud-auth');

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function member(req, workspaceId) {
  const user = await currentUser(req);
  if (!user) return null;
  const rows = await db()`SELECT 1 FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${user.id} AND revoked_at IS NULL`;
  return rows.length ? user : null;
}

async function readState(workspaceId) {
  const sql = db();
  const [sections, subsections, items, marks] = await Promise.all([
    sql`SELECT id, num, title, sort_order, deleted, updated_at FROM sections WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
    sql`SELECT id, section_id, num, title, sort_order, deleted, updated_at FROM subsections WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
    sql`SELECT id, subsection_id, label, qty, target, spec, phase, tags, store, sort_order, deleted, updated_at FROM items WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
    sql`SELECT item_id, status, q, sp, n, c, updated_at FROM marks WHERE workspace_id = ${workspaceId}`,
  ]);
  return { sections, subsections, items, marks };
}

function rows(body, key, max) {
  const value = body[key];
  if (!Array.isArray(value) || value.length > max) throw new Error('invalid_' + key);
  return value;
}

module.exports = async function handler(req, res) {
  const workspaceId = req.query && req.query.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_required' });
  try {
    const user = await member(req, workspaceId);
    if (!user) return res.status(401).json({ error: 'not_authorized' });
    if (req.method === 'GET') return res.status(200).json(await readState(workspaceId));
    if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
    const body = parseBody(req);
    const sections = rows(body, 'sections', 100);
    const subsections = rows(body, 'subsections', 1000);
    const items = rows(body, 'items', 5000);
    const marks = rows(body, 'marks', 5000);
    const sql = db();
    for (const r of sections) await sql`INSERT INTO sections (id, workspace_id, num, title, sort_order, deleted, updated_at) VALUES (${String(r.id)}, ${workspaceId}, ${Number(r.num) || 0}, ${String(r.title || '').slice(0, 300)}, ${Number(r.sortOrder) || 0}, ${!!r.deleted}, ${r.updatedAt || new Date().toISOString()}) ON CONFLICT (id) DO UPDATE SET title = excluded.title, num = excluded.num, sort_order = excluded.sort_order, deleted = excluded.deleted, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id WHERE sections.workspace_id = excluded.workspace_id`;
    for (const r of subsections) await sql`INSERT INTO subsections (id, workspace_id, section_id, num, title, sort_order, deleted, updated_at) VALUES (${String(r.id)}, ${workspaceId}, ${String(r.sectionId)}, ${String(r.num || '')}, ${String(r.title || '').slice(0, 300)}, ${Number(r.sortOrder) || 0}, ${!!r.deleted}, ${r.updatedAt || new Date().toISOString()}) ON CONFLICT (id) DO UPDATE SET title = excluded.title, num = excluded.num, sort_order = excluded.sort_order, deleted = excluded.deleted, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id WHERE subsections.workspace_id = excluded.workspace_id`;
    for (const r of items) await sql`INSERT INTO items (id, workspace_id, subsection_id, label, qty, target, spec, phase, tags, store, sort_order, deleted, updated_at) VALUES (${String(r.id)}, ${workspaceId}, ${String(r.subsectionId)}, ${String(r.label || '').slice(0, 500)}, ${!!r.qty}, ${r.target == null ? null : Number(r.target)}, ${!!r.spec}, ${r.phase == null ? null : Number(r.phase)}, ${Array.isArray(r.tags) ? r.tags : []}, ${String(r.store || 'General').slice(0, 100)}, ${Number(r.sortOrder) || 0}, ${!!r.deleted}, ${r.updatedAt || new Date().toISOString()}) ON CONFLICT (id) DO UPDATE SET label = excluded.label, qty = excluded.qty, target = excluded.target, spec = excluded.spec, phase = excluded.phase, tags = excluded.tags, store = excluded.store, sort_order = excluded.sort_order, deleted = excluded.deleted, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id WHERE items.workspace_id = excluded.workspace_id`;
    for (const r of marks) await sql`INSERT INTO marks (item_id, workspace_id, status, q, sp, n, c, updated_at) VALUES (${String(r.itemId)}, ${workspaceId}, ${r.status || null}, ${r.q == null ? null : Number(r.q)}, ${r.sp || null}, ${r.n || null}, ${r.c == null ? null : Number(r.c)}, ${r.updatedAt || new Date().toISOString()}) ON CONFLICT (item_id) DO UPDATE SET status = excluded.status, q = excluded.q, sp = excluded.sp, n = excluded.n, c = excluded.c, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id WHERE marks.workspace_id = excluded.workspace_id`;
    await sql`INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, action, metadata) VALUES (${crypto.randomUUID()}, ${workspaceId}, ${user.id}, 'workspace', 'state_replace', ${JSON.stringify({ sections: sections.length, items: items.length, marks: marks.length })}::jsonb)`;
    res.status(200).json(await readState(workspaceId));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message === 'invalid_items' || err.message === 'invalid_marks' || err.message === 'invalid_sections' || err.message === 'invalid_subsections' ? err.message : 'state_failed' });
  }
};
