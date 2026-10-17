const { currentUser, db } = require('../../../lib/cloud-auth');

async function authorized(req, workspaceId) {
  const user = await currentUser(req);
  if (!user) return null;
  const rows = await db()`SELECT 1 FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${user.id} AND revoked_at IS NULL`;
  return rows.length ? user : null;
}

module.exports = async function handler(req, res) {
  const workspaceId = req.query && req.query.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_required' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    if (!await authorized(req, workspaceId)) return res.status(401).json({ error: 'not_authorized' });
    const sql = db();
    const [sections, subsections, items, marks] = await Promise.all([
      sql`SELECT id, num, title, sort_order, deleted, updated_at FROM sections WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
      sql`SELECT id, section_id, num, title, sort_order, deleted, updated_at FROM subsections WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
      sql`SELECT id, subsection_id, label, qty, target, spec, phase, tags, store, sort_order, deleted, updated_at FROM items WHERE workspace_id = ${workspaceId} ORDER BY sort_order, id`,
      sql`SELECT item_id, status, q, sp, n, c, updated_at FROM marks WHERE workspace_id = ${workspaceId}`,
    ]);
    res.status(200).json({ sections, subsections, items, marks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'checklist_failed' });
  }
};
