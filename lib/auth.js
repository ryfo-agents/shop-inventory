// Retired shared-passphrase authentication: old signed cookies fail closed.
module.exports = {
  verifyPassphrase: () => false,
  requireSession: () => false,
  setSessionCookie: () => { throw new Error('legacy_api_disabled'); },
  clearSessionCookie: () => { throw new Error('legacy_api_disabled'); },
};
