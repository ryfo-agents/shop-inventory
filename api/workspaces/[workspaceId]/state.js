const { workspaceHandler, readState } = require('../../../lib/workspace-api');
// Broad snapshots are deliberately read-only. Structural editing remains disabled.
module.exports = workspaceHandler(['GET'], async (req,res,workspaceId,user) => {
  return res.status(200).json(await readState(workspaceId,user.id,true));
});
