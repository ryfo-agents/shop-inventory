const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ORIGIN = 'https://shop.test';

function worker() {
  const handlers = {}, stores = new Map(), calls = [];
  let offline = false, failPath = null, skipped = 0, claimed = 0;
  const key = r => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  async function network(req, options) {
    calls.push({ url: key(req), cache: options?.cache || req.cache, method: req.method || 'GET' });
    if (offline || new URL(key(req)).pathname === failPath) throw new TypeError('Offline');
    return new Response(new URL(key(req)).pathname.startsWith('/api') ? 'private-account-B' : 'shell:' + key(req));
  }
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(r) { return store.get(key(r))?.clone(); },
        async put(r, response) { store.set(key(r), response.clone()); },
        async keys() { return [...store.keys()].map(u => new Request(u)); },
        async delete(r) { return store.delete(key(r)); },
        async add(r) { const res = await network(r); store.set(key(r), res); },
        async addAll(rs) { const entries = await Promise.all(rs.map(async r => [key(r), await network(r)])); entries.forEach(([k,v]) => store.set(k,v)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(r) { for (const name of stores.keys()) { const found = await (await caches.open(name)).match(r); if (found) return found; } }
  };
  const self = {
    location: { origin: ORIGIN, href: ORIGIN + '/sw.js' }, registration: { scope: ORIGIN + '/' },
    addEventListener(type, fn) { handlers[type] = fn; },
    async skipWaiting() { skipped++; }, clients: { async claim() { claimed++; } }
  };
  class WorkerRequest extends Request {
    constructor(input, init) { super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), { self, caches, fetch: network, Request: WorkerRequest, Response, URL, Set, Promise });
  return { stores, caches, calls, offline() { offline = true; }, fail(path) { failPath = path; }, get skipped() { return skipped; }, get claimed() { return claimed; },
    async lifecycle(type, data) { const jobs = []; handlers[type]?.({ data, waitUntil(p) { jobs.push(p); } }); await Promise.all(jobs); },
    async request(path, { method = 'GET', navigate = false } = {}) {
      const req = new Request(new URL(path, ORIGIN), { method });
      if (navigate) Object.defineProperty(req, 'mode', { value: 'navigate' });
      const jobs = []; let response;
      handlers.fetch({ request: req, respondWith(p) { response = p; }, waitUntil(p) { jobs.push(p); } });
      const result = await (response || network(req)); await Promise.all(jobs); return result;
    }
  };
}

test('authenticated API reads ignore old account caches and bypass HTTP cache', async () => {
  const w = worker();
  await (await w.caches.open('shop-inv-v9')).put('/api/auth/me', new Response('private-account-A'));
  assert.equal(await (await w.request('/api/auth/me')).text(), 'private-account-B');
  assert.equal(w.calls.at(-1).cache, 'no-store');
  assert.equal(w.stores.size, 1);
});

test('only shell navigations receive HTML fallback, never asset or API failures', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.offline();
  assert.match(await (await w.request('/?audit=1', { navigate: true })).text(), /shell:/);
  await assert.rejects(w.request('/missing.js'), /Offline/);
  await assert.rejects(w.request('/api/workspaces/a/state', { navigate: true }), /Offline/);
  await assert.rejects(w.request('/account/export', { navigate: true }), /Offline/);
});

test('only exact same-origin public shell assets enter Cache Storage', async () => {
  const w = worker();
  for (const path of ['/private.json', '/api', '/api/auth/me?fresh=1', 'https://cdn.test/x.js', '/greenfield/app.js?user=A']) {
    await w.request(path);
  }
  assert.equal(w.stores.size, 0);
  await w.request('/greenfield/app.js?v=10');
  assert.equal(w.stores.size, 1);
  const urls = [...w.stores.values()].flatMap(s => [...s.keys()]);
  assert.deepEqual(urls, [ORIGIN + '/greenfield/app.js?v=10']);
});

test('activation purges legacy private caches and unsafe entries in current shell cache', async () => {
  const w = worker();
  for (const name of ['shop-inv-v8', 'shop-inv-v9', 'shop-inv-shell-v9', 'shop-inv-shell-v10']) {
    await (await w.caches.open(name)).put('/api/workspaces/A/state', new Response('private-A'));
  }
  await (await w.caches.open('other-app')).put('/other-app/logo.png', new Response('public'));
  await w.lifecycle('activate');
  assert.deepEqual([...w.stores.keys()].sort(), ['other-app', 'shop-inv-shell-v10']);
  assert.deepEqual([...w.stores.get('shop-inv-shell-v10').keys()], []);
  assert.equal(w.claimed, 1);
});

test('API methods and failures stay network-only with no HTML or cached success', async () => {
  const w = worker();
  await w.lifecycle('install');
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    await w.request('/api/auth/logout', { method });
    assert.equal(w.calls.at(-1).cache, 'no-store');
  }
  w.offline();
  await assert.rejects(w.request('/api/auth/me'), /Offline/);
  for (const store of w.stores.values()) assert.ok([...store.keys()].every(url => !url.includes('/api')));
});

test('install is all-or-nothing and never activates an incomplete shell', async () => {
  const w = worker();
  await (await w.caches.open('shop-inv-v9')).put('/index.html', new Response('old-shell'));
  w.fail('/greenfield/app.js');
  await assert.rejects(w.lifecycle('install'), /Offline/);
  assert.equal(w.skipped, 0);
  assert.equal(w.stores.get('shop-inv-shell-v10').size, 0);
  assert.ok(w.stores.has('shop-inv-v9'));
});

test('versioned assets remain coherent offline without background replacement', async () => {
  const w = worker();
  await w.lifecycle('install');
  assert.equal(w.skipped, 1);
  const before = w.calls.length;
  w.offline();
  assert.match(await (await w.request('/greenfield/app.js?v=10')).text(), /shell:/);
  assert.equal(w.calls.length, before);
  await assert.rejects(w.request('/greenfield/app.js?v=11'), /Offline/);
  assert.match(await (await w.request('/greenfield/', { navigate: true })).text(), /greenfield\/index.html/);
});

test('online navigations use network without mutating the offline snapshot', async () => {
  const w = worker();
  await w.lifecycle('install');
  const shell = w.stores.get('shop-inv-shell-v10');
  const before = await shell.get(ORIGIN + '/index.html').clone().text();
  await w.request('/?fresh=1', { navigate: true });
  assert.equal(w.calls.at(-1).cache, 'no-store');
  assert.equal(await shell.get(ORIGIN + '/index.html').clone().text(), before);
  assert.ok(!shell.has(ORIGIN + '/?fresh=1'));
});

module.exports = { worker };
