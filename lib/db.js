// Compatibility exports for retired sync clients. Unscoped inventory access is
// deliberately unavailable even if a stale caller imports these helpers.
async function disabled() { throw new Error('legacy_api_disabled'); }
module.exports = {
  db: require('./cloud-auth').db,
  getChangedSince: disabled,
  upsertSections: disabled,
  upsertSubsections: disabled,
  upsertItems: disabled,
  upsertMarks: disabled,
};
