const { workspaceHandler, parseBody, validateMark, patchMarks } = require('../../../lib/workspace-api');
module.exports = workspaceHandler(['POST'], async (req,res,workspaceId,user) => {
  const body=parseBody(req);
  if (Object.keys(body).some(k => k !== 'marks') || !Array.isArray(body.marks) || body.marks.length < 1 || body.marks.length > 100) return res.status(400).json({error:'invalid_marks'});
  const marks=body.marks.map(b => validateMark(b,true));
  if (new Set(marks.map(b => b.itemId)).size !== marks.length) return res.status(400).json({error:'invalid_marks'});
  return res.status(200).json(await patchMarks(workspaceId,user.id,marks));
});
