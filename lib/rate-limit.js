const buckets = new Map();

function allow(key, limit, windowMs) {
  const now = Date.now();
  const existing = buckets.get(key) || { start: now, count: 0 };
  if (now - existing.start >= windowMs) {
    existing.start = now; existing.count = 0;
  }
  existing.count += 1;
  buckets.set(key, existing);
  return existing.count <= limit;
}

function clientKey(req, scope) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return scope + ':' + (forwarded || req.socket && req.socket.remoteAddress || 'unknown');
}

module.exports = { allow, clientKey };
