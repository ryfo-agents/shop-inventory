const { db } = require('../lib/cloud-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await db()`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch (err) {
    // Connection errors can embed DATABASE_URL; never emit raw errors.
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
};
