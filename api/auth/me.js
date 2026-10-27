const { currentUser, workspaceForUser } = require('../../lib/cloud-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    const workspace = await workspaceForUser(user.id);
    res.status(200).json({ user: { id: user.id, email: user.email, displayName: user.display_name }, workspace });
  } catch (err) {
    // Do not log database errors containing private row data.
    res.status(500).json({ error: 'me_failed' });
  }
};
