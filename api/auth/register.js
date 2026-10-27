const { normalizeEmail, registerAccount } = require('../../lib/cloud-auth');
const { parseBody } = require('../../lib/workspace-api');
const { allow, clientKey } = require('../../lib/rate-limit');
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({ error:'method_not_allowed' });
  if (!allow(clientKey(req,'register'),10,15*60*1000)) return res.status(429).json({ error:'too_many_requests' });
  let input;
  try { input=parseBody(req); } catch (_) { return res.status(400).json({error:'invalid_body'}); }
  const email=normalizeEmail(input.email);
  const password=typeof input.password === 'string' ? input.password : '';
  const displayName=typeof input.displayName === 'string' ? input.displayName.trim().slice(0,120) : '';
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || password.length<12 || password.length>1024) return res.status(400).json({error:'email_and_password_required'});
  try {
    return res.status(201).json(await registerAccount(res,email,displayName,password));
  } catch (err) {
    return res.status(err.code==='23505'?409:500).json({error:err.code==='23505'?'account_exists':'registration_failed'});
  }
};
