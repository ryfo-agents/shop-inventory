const { workspaceHandler, parseBody, validateMark, validId, patchMarks } = require('../../../../lib/workspace-api');
module.exports = workspaceHandler(['PUT','PATCH'], async (req,res,workspaceId,user) => {
  const itemId=req.query && req.query.itemId;
  if (!validId(itemId)) return res.status(400).json({ error:'invalid_item' });
  const mark=validateMark(parseBody(req));
  const result=await patchMarks(workspaceId,user.id,[{...mark,itemId}]);
  return res.status(200).json({mark:result.marks[0],revision:result.revision});
});
