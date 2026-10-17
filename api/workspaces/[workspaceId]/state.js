const crypto = require('crypto');
const { currentUser, db } = require('../../../lib/cloud-auth');
const checklist = require('../../../data/checklist.json');

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

async function bulkInsert(sql, table, columns, rows) {
  if (!rows.length) return;
  const params = [];
  const values = rows.map(row => '(' + row.map(value => { params.push(value); return '$' + params.length; }).join(',') + ')').join(',');
  await sql.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ON CONFLICT DO NOTHING`, params);
}

async function bulkUpsert(sql, table, columns, rows, conflictColumn, updateColumns) {
  if (!rows.length) return;
  const params = [];
  const values = rows.map(row => '(' + row.map(value => { params.push(value); return '$' + params.length; }).join(',') + ')').join(',');
  const updates = updateColumns.map(column => `${column} = excluded.${column}`).join(', ');
  await sql.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates} WHERE ${table}.workspace_id = excluded.workspace_id`, params);
}
async function bootstrapWorkspace(workspaceId, actorId) {
  const existing = await db()`SELECT id FROM sections WHERE workspace_id = ${workspaceId} LIMIT 1`;
  if (existing.length) return;
  const sql = db();
  const now = new Date().toISOString();
  const sections = [];
  const subsections = [];
  const items = [];
  for (let si = 0; si < checklist.sections.length; si++) {
    const sec = checklist.sections[si];
    const sectionId = `${workspaceId}:${sec.id}`;
    sections.push([sectionId, workspaceId, sec.num, sec.title, si, false, now]);
    for (let bi = 0; bi < sec.subsections.length; bi++) {
      const sub = sec.subsections[bi];
      const subsectionId = `${workspaceId}:${sub.id}`;
      subsections.push([subsectionId, workspaceId, sectionId, sub.num, sub.title, bi, false, now]);
      for (let ii = 0; ii < sub.items.length; ii++) {
        const item = sub.items[ii];
        items.push([`${workspaceId}:${item.id}`, workspaceId, subsectionId, item.label, !!item.qty, item.target == null ? null : item.target, !!item.spec, item.phase == null ? null : item.phase, item.tags || [], item.store || 'General', ii, false, now]);
      }
    }
  }
  await bulkInsert(sql, 'sections', ['id', 'workspace_id', 'num', 'title', 'sort_order', 'deleted', 'updated_at'], sections);
  await bulkInsert(sql, 'subsections', ['id', 'workspace_id', 'section_id', 'num', 'title', 'sort_order', 'deleted', 'updated_at'], subsections);
  await bulkInsert(sql, 'items', ['id', 'workspace_id', 'subsection_id', 'label', 'qty', 'target', 'spec', 'phase', 'tags', 'store', 'sort_order', 'deleted', 'updated_at'], items);
  await sql`INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, action, metadata) VALUES (${crypto.randomUUID()}, ${workspaceId}, ${actorId}, 'workspace', 'bootstrap', ${JSON.stringify({ sections: sections.length, items: items.length })}::jsonb)`;
}

module.exports = async function handler(req, res) {
  const workspaceId = req.query && req.query.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_required' });
  try {
    const user = await member(req, workspaceId);
    if (!user) return res.status(401).json({ error: 'not_authorized' });
    await bootstrapWorkspace(workspaceId, user.id);
    if (req.method === 'GET') return res.status(200).json(await readState(workspaceId));
    if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
    const body = parseBody(req);
    const sections = rows(body, 'sections', 100);
    const subsections = rows(body, 'subsections', 1000);
    const items = rows(body, 'items', 5000);
    const marks = rows(body, 'marks', 5000);
    const sql = db();
    await bulkUpsert(sql, 'sections', ['id', 'workspace_id', 'num', 'title', 'sort_order', 'deleted', 'updated_at'], sections.map(r => [String(r.id), workspaceId, Number(r.num) || 0, String(r.title || '').slice(0, 300), Number(r.sortOrder) || 0, !!r.deleted, r.updatedAt || new Date().toISOString()]), 'id', ['title', 'num', 'sort_order', 'deleted', 'updated_at', 'workspace_id']);
    await bulkUpsert(sql, 'subsections', ['id', 'workspace_id', 'section_id', 'num', 'title', 'sort_order', 'deleted', 'updated_at'], subsections.map(r => [String(r.id), workspaceId, String(r.sectionId), String(r.num || ''), String(r.title || '').slice(0, 300), Number(r.sortOrder) || 0, !!r.deleted, r.updatedAt || new Date().toISOString()]), 'id', ['title', 'num', 'sort_order', 'deleted', 'updated_at', 'workspace_id', 'section_id']);
    await bulkUpsert(sql, 'items', ['id', 'workspace_id', 'subsection_id', 'label', 'qty', 'target', 'spec', 'phase', 'tags', 'store', 'sort_order', 'deleted', 'updated_at'], items.map(r => [String(r.id), workspaceId, String(r.subsectionId), String(r.label || '').slice(0, 500), !!r.qty, r.target == null ? null : Number(r.target), !!r.spec, r.phase == null ? null : Number(r.phase), Array.isArray(r.tags) ? r.tags : [], String(r.store || 'General').slice(0, 100), Number(r.sortOrder) || 0, !!r.deleted, r.updatedAt || new Date().toISOString()]), 'id', ['label', 'qty', 'target', 'spec', 'phase', 'tags', 'store', 'sort_order', 'deleted', 'updated_at', 'workspace_id', 'subsection_id']);
    await bulkUpsert(sql, 'marks', ['item_id', 'workspace_id', 'status', 'q', 'sp', 'n', 'c', 'updated_at'], marks.map(r => [String(r.itemId), workspaceId, r.status || null, r.q == null ? null : Number(r.q), r.sp || null, r.n || null, r.c == null ? null : Number(r.c), r.updatedAt || new Date().toISOString()]), 'item_id', ['status', 'q', 'sp', 'n', 'c', 'updated_at', 'workspace_id']);
    await sql`INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, action, metadata) VALUES (${crypto.randomUUID()}, ${workspaceId}, ${user.id}, 'workspace', 'state_replace', ${JSON.stringify({ sections: sections.length, items: items.length, marks: marks.length })}::jsonb)`;
    res.status(200).json(await readState(workspaceId));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message === 'invalid_items' || err.message === 'invalid_marks' || err.message === 'invalid_sections' || err.message === 'invalid_subsections' ? err.message : 'state_failed' });
  }
};
