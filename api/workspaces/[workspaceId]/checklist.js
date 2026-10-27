const { workspaceHandler, readState } = require('../../../lib/workspace-api');
module.exports = workspaceHandler(['GET'], async (req,res,workspaceId,user) => {
  return res.status(200).json(await readState(workspaceId,user.id));
});
