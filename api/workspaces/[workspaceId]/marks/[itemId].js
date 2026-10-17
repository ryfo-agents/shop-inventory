const crypto = require('crypto');
const { currentUser, db } = require('../../../../lib/cloud-auth');

function input(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  const workspaceId = req.query && req.query.workspaceId;
  const itemId = req.query && req.query.itemId;
  if (!workspaceId || !itemId) return res.status(400).json({ error: 'workspace_and_item_required' });
  if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    const member = await db()`SELECT 1 FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${user.id} AND revoked_at IS NULL`;
    if (!member.length) return res.status(403).json({ error: 'forbidden' });
    const item = await db()`SELECT id FROM items WHERE id = ${itemId} AND workspace_id = ${workspaceId} AND deleted = false`;
    if (!item.length) return res.status(404).json({ error: 'item_not_found' });
    const b = input(req);
    const statuses = ['unknown', 'have', 'missing', 'upgrade', 'blocking', 'na'];
    if (b.status != null && !statuses.includes(b.status)) return res.status(400).json({ error: 'invalid_status' });
    if (b.q != null && (!Number.isInteger(b.q) || b.q < 0)) return res.status(400).json({ error: 'invalid_quantity' });
    if (b.c != null && (typeof b.c !== 'number' || b.c < 0)) return res.status(400).json({ error: 'invalid_cost' });
    const now = new Date().toISOString();
    const rows = await db()`INSERT INTO marks (item_id, workspace_id, status, q, sp, n, c, updated_at)
      VALUES (${itemId}, ${workspaceId}, ${b.status || null}, ${b.q == null ? null : b.q}, ${b.sp || null}, ${b.n || null}, ${b.c == null ? null : b.c}, ${now})
      ON CONFLICT (item_id) DO UPDATE SET status = excluded.status, q = excluded.q, sp = excluded.sp, n = excluded.n, c = excluded.c, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id
      RETURNING item_id, status, q, sp, n, c, updated_at`;
    await db()`INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, entity_id, action, metadata) VALUES (${crypto.randomUUID()}, ${workspaceId}, ${user.id}, 'mark', ${itemId}, 'upsert', ${JSON.stringify({ fields: Object.keys(b) })}::jsonb)`;
    res.status(200).json({ mark: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'mark_update_failed' });
  }
};
