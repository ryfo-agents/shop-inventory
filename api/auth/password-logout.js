const { revokeSession } = require('../../lib/cloud-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await revokeSession(req, res);
    res.status(200).json({ ok: true });
  } catch (err) {
    // Do not log database errors containing private row data.
    res.status(500).json({ error: 'logout_failed' });
  }
};
