// Retired shared-passphrase API. Never inspect credentials or access inventory.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'legacy_api_disabled' });
};
