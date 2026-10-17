const { db } = require('../lib/cloud-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await db()`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
};
