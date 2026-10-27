const { currentUser, db } = require('./cloud-auth');
const checklist = require('../data/checklist.json');
const seed = { sections: [], subsections: [], items: [] };
checklist.sections.forEach((section, si) => {
  seed.sections.push({ id: section.id, num: section.num, title: section.title, sort_order: si });
  section.subsections.forEach((sub, bi) => {
    seed.subsections.push({ id: sub.id, section_id: section.id, num: String(sub.num), title: sub.title, sort_order: bi });
    sub.items.forEach((item, ii) => seed.items.push({ ...item, subsection_id: sub.id, sort_order: ii }));
  });
});
const seedJSON = JSON.stringify(seed);
const publicErrors = {
  forbidden: 403, item_not_found: 404, revision_conflict: 409,
  precondition_required: 428, body_too_large: 413,
  invalid_json: 400, invalid_body: 400, invalid_marks: 400, invalid_mark: 400,
  invalid_item: 400, invalid_version: 400, invalid_status: 400,
  invalid_quantity: 400, invalid_cost: 400, invalid_spec: 400, invalid_note: 400,
};
function fail(message) { throw new Error(message); }
function noStore(res) { res.setHeader('Cache-Control', 'no-store'); }
function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > 1024 * 1024) fail('body_too_large');
    try { body = JSON.parse(String(body)); } catch (_) { fail('invalid_json'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_body');
  if (Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024) fail('body_too_large');
  return body;
}
function validateMark(b, bulk = false) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('invalid_mark');
  const keys = ['status','q','sp','n','c','version', ...(bulk ? ['itemId'] : [])];
  if (Object.keys(b).some(k => !keys.includes(k))) fail('invalid_mark');
  if (!Object.hasOwn(b,'version')) fail('precondition_required');
  if (!Number.isSafeInteger(b.version) || b.version < 0) fail('invalid_version');
  if (!['status','q','sp','n','c'].some(k => Object.hasOwn(b,k))) fail('invalid_mark');
  if (Object.hasOwn(b,'status') && b.status !== null && !['unknown','have','missing','upgrade','blocking','na'].includes(b.status)) fail('invalid_status');
  if (Object.hasOwn(b,'q') && b.q !== null && (!Number.isInteger(b.q) || b.q < 0 || b.q > 2147483647)) fail('invalid_quantity');
  if (Object.hasOwn(b,'c') && b.c !== null && (typeof b.c !== 'number' || !Number.isFinite(b.c) || b.c < 0 || b.c > 1e9)) fail('invalid_cost');
  for (const [key,max,error] of [['sp',2000,'invalid_spec'],['n',10000,'invalid_note']]) {
    if (Object.hasOwn(b,key) && b[key] !== null && (typeof b[key] !== 'string' || b[key].length > max)) fail(error);
  }
  if (bulk && !validId(b.itemId)) fail('invalid_item');
  return b;
}
function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 300; }
async function requireActiveWorkspace(req, workspaceId) {
  const user = await currentUser(req);
  if (!user) { const err = new Error('not_authenticated'); err.status=401; throw err; }
  // Mutation and snapshot functions recheck this policy under their own locks.
  await db()`SELECT shop_assert_access(${workspaceId}, ${user.id}, false)`;
  return user;
}
function workspaceHandler(methods, action) {
  return async (req,res) => {
    noStore(res);
    if (!methods.includes(req.method)) {
      res.setHeader('Allow',methods.join(', '));
      return res.status(405).json({ error:'method_not_allowed' });
    }
    const workspaceId=req.query && req.query.workspaceId;
    if (!validId(workspaceId)) return res.status(400).json({ error:'workspace_required' });
    try {
      const user=await requireActiveWorkspace(req,workspaceId);
      return await action(req,res,workspaceId,user);
    } catch (err) {
      const status=err.status || publicErrors[err.message] || 500;
      // Never log raw database errors: they can contain private marks/secrets.
      return res.status(status).json({ error: status===500 ? 'workspace_request_failed' : err.message });
    }
  };
}
async function readState(workspaceId,userId,bootstrap=false) {
  const rows=await db()`SELECT shop_state(${workspaceId},${userId},${bootstrap ? seedJSON : null}::jsonb) AS state`;
  return rows[0].state;
}
async function patchMarks(workspaceId,userId,marks) {
  const rows=await db()`SELECT shop_patch_marks(${workspaceId},${userId},${JSON.stringify(marks)}::jsonb) AS result`;
  return rows[0].result;
}
module.exports={workspaceHandler,parseBody,validateMark,validId,readState,patchMarks,noStore};
