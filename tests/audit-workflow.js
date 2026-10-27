const fs = require('fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { validateMark } = require('../lib/workspace-api');
const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('greenfield/app.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
function fixture() {
  return { sections: [{ id: 's1', num: 1, title: 'Safety', sort_order: 0 }, { id: 's2', num: 2, title: 'Tools', sort_order: 1 }],
    subsections: [{ id: 'b1', section_id: 's1', title: 'Eyes', sort_order: 0 }, { id: 'b2', section_id: 's1', title: 'Stock', sort_order: 1 }, { id: 'b3', section_id: 's2', title: 'Bench', sort_order: 0 }],
    items: [{ id: 'i2', subsection_id: 'b2', label: 'Discs', qty: true, target: 5, store: 'Hardware', sort_order: 0 }, { id: 'i1', subsection_id: 'b1', label: 'Glasses', store: 'General', sort_order: 0 }, { id: 'i3', subsection_id: 'b3', label: 'Hammer', sort_order: 0 }],
    marks: [{ item_id: 'i1', status: 'unknown', q: 2, sp: 'ANSI', n: 'Blue pair', c: 12.5 }] };
}
async function client(state = fixture(), hash = '#/section/s1') {
  const dom = new JSDOM(html, { url: 'http://localhost/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, requests = [];
  w.fetch = async (url, options) => {
    if (url.endsWith('/auth/me')) return response({ user: { email: 'qa@example.test' }, workspace: { id: 'w1', name: 'QA' } });
    if (url.endsWith('/state')) return response({ ...state, marks: state.marks.map(mark => ({ version: 0, ...mark })) });
    if (url.includes('/marks/')) {
      const body = JSON.parse(options.body);
      validateMark(body);
      return new Promise(resolve => requests.push({ id: url.split('/').pop(), body, resolve: (status = 200, mark) => resolve(response(status < 400 ? { mark: mark || { ...body, item_id: url.split('/').pop(), version: body.version + 1, updated_at: '2026-10-26T12:00:00Z' }, revision: 1000 + requests.length } : { error: status === 401 ? 'not_authenticated' : 'write_failed' }, status)) }));
    }
    throw new Error('Unexpected request: ' + url);
  };
  w.eval(script); await tick();
  return { w, d: w.document, requests, close: () => w.close(), click(selector) { const el = w.document.querySelector(selector); assert.ok(el, selector); el.click(); }, async route(hash) { w.location.hash = hash; await tick(); } };
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
test('malformed native numeric drafts never clear prior count or cost', async () => {
  for (const field of ['q', 'c']) {
    const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 3, c: 12 });
    const c = await client(state);
    const input = c.d.querySelector('[data-item-id="i2"] [data-field="' + field + '"]');
    // Chromium exposes an unfinished exponent as value='' with badInput=true.
    // jsdom sanitizes the value but does not implement native number editing.
    input.value = '';
    Object.defineProperty(input.validity, 'badInput', { configurable: true, get: () => true });
    input.dispatchEvent(new c.w.Event('input', { bubbles: true }));
    input.dispatchEvent(new c.w.Event('change', { bubbles: true }));
    assert.equal(c.requests.length, 0, field + ' malformed blank must not become null');
    assert.match(input.closest('.item-row').querySelector('.item-status').textContent, /Not saved/);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    c.close();
  }
});
test('invalid numeric drafts stay visible across input, navigation and unrelated saves; export waits', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 3, c: 12 });
  const c = await client(state);
  const q = c.d.querySelector('[data-item-id="i2"] [data-field="q"]');
  q.value = '-1'; q.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  assert.match(c.d.querySelector('#write-summary').textContent, /not saved/i, 'input event already exposes invalid draft');
  c.click('[data-action="mark"][data-id="i2"]'); c.requests[0].resolve(); await tick();
  assert.equal(q.value, '-1', 'acknowledgment must not erase invalid draft');
  assert.equal(c.requests[0].body.q, 3, 'unrelated save preserves previous count');
  assert.doesNotMatch(c.d.querySelector('#live').textContent, /All changes saved/);
  await c.route('#/buy'); c.click('[data-action="export"]');
  assert.equal(c.d.querySelector('#purchase-export'), null);
  assert.match(c.d.querySelector('#export-result').textContent, /unavailable/);
  assert.match(c.d.querySelector('#write-summary').textContent, /draft.*correct|correct.*draft/i);
  await c.route('#/section/s1');
  const restored = c.d.querySelector('[data-item-id="i2"] [data-field="q"]');
  assert.equal(restored.value, '-1'); assert.equal(restored.getAttribute('aria-invalid'), 'true');
  const unload = new c.w.Event('beforeunload', { cancelable: true }); c.w.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
  restored.value = '0'; restored.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  assert.equal(c.requests[1].body.q, 0); c.requests[1].resolve(); await tick();
  assert.match(c.d.querySelector('#write-summary').textContent, /All changes saved/);
  c.close();
});
test('deliberate numeric clear and zero remain distinct and reload explicitly discards invalid drafts', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 3, c: 12 });
  const c = await client(state);
  for (const field of ['q', 'c']) {
    const input = c.d.querySelector('[data-item-id="i2"] [data-field="' + field + '"]');
    for (const [value, expected] of [['', null], ['0', 0]]) {
      input.value = value; input.dispatchEvent(new c.w.Event('change', { bubbles: true }));
      assert.equal(c.requests.at(-1).body[field], expected); c.requests.at(-1).resolve(); await tick();
    }
  }
  const q = c.d.querySelector('[data-item-id="i2"] [data-field="q"]');
  q.value = '1.5'; q.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.click('[data-action="reload-cloud"]'); await tick();
  assert.equal(c.d.querySelector('[data-item-id="i2"] [data-field="q"]').value, '3');
  assert.doesNotMatch(c.d.querySelector('#write-summary').textContent, /not saved/i);
  c.close();
});
test('rapid taps serialize and coalesce while preserving all metadata', async () => {
  const c = await client();
  const selector = '[data-action="mark"][data-id="i1"]';
  const original = c.d.querySelector(selector); original.focus(); original.click(); original.click(); original.click();
  assert.equal(c.requests.length, 1, 'one in-flight write per item');
  assert.equal(c.d.querySelector(selector).dataset.status, 'upgrade', 'latest optimistic intent');
  assert.equal(c.d.activeElement, original, 'status control keeps focus and identity');
  assert.deepEqual(c.requests[0].body, { status: 'have', q: 2, sp: 'ANSI', n: 'Blue pair', c: 12.5, version: 0 });
  c.requests[0].resolve(); await tick();
  assert.equal(c.requests.length, 2);
  assert.equal(c.requests[1].body.status, 'upgrade', 'intermediate missing is coalesced');
  assert.equal(c.requests[1].body.version, 1, 'mark version, not workspace revision or local tap count');
  assert.equal(c.d.querySelector(selector).dataset.status, 'upgrade', 'old acknowledgment cannot regress UI');
  c.requests[1].resolve(); await tick();
  assert.match(c.d.querySelector(selector).closest('.item-row').textContent, /Saved/);
  c.close();
});
test('failed latest intent stays visibly unsaved across navigation and retry; offline never edits', async () => {
  const c = await client();
  const selector = '[data-action="mark"][data-id="i1"]';
  c.click(selector); c.click(selector);
  c.requests[0].resolve(500); await tick();
  assert.equal(c.requests.length, 1, 'failure does not automatically replay');
  assert.equal(c.d.querySelector(selector).dataset.status, 'missing');
  await c.route('#/buy'); await c.route('#/section/s1');
  assert.match(c.d.querySelector(selector).closest('.item-row').textContent, /Not saved/);
  c.click('[data-action="retry"][data-id="i1"]');
  assert.equal(c.requests[1].body.status, 'missing');
  c.requests[1].resolve(); await tick();
  Object.defineProperty(c.w.navigator, 'onLine', { configurable: true, value: false });
  c.click(selector);
  assert.equal(c.requests.length, 2);
  assert.equal(c.d.querySelector(selector).dataset.status, 'missing');
  assert.match(c.d.querySelector('#live').textContent, /Offline/);
  c.close();
});
test('reordered independent items and session expiry cannot replace the auth screen', async () => {
  const c = await client();
  c.click('[data-action="mark"][data-id="i1"]'); c.click('[data-action="mark"][data-id="i2"]');
  c.requests[1].resolve(401); await tick();
  assert.match(c.d.body.textContent, /session expired/);
  c.requests[0].resolve(); await tick();
  await c.route('#/buy');
  assert.ok(c.d.querySelector('#auth-form'));
  c.close();
});
test('count, details, undo and confirmed purchase CSV survive reload', async () => {
  const c = await client();
  const change = (field, value) => { const el = c.d.querySelector('[data-item-id="i2"] [data-field="' + field + '"]'); assert.ok(el, field + ' control'); el.value = value; el.dispatchEvent(new c.w.Event('change', { bubbles: true })); };
  change('q', '0'); assert.equal(c.requests[0].body.q, 0); c.requests[0].resolve(); await tick();
  change('sp', '80 grit'); c.requests[1].resolve(); await tick();
  change('n', 'Buy box'); c.requests[2].resolve(); await tick();
  change('c', '20.50'); c.requests[3].resolve(); await tick();
  c.click('[data-action="mark"][data-id="i2"]');
  assert.deepEqual(c.requests[4].body, { status: 'have', q: 0, sp: '80 grit', n: 'Buy box', c: 20.5, version: 4 });
  c.requests[4].resolve(); await tick();
  c.click('[data-action="undo"]'); assert.equal(c.requests[5].body.status, 'unknown'); assert.equal(c.requests[5].body.q, 0);
  c.requests[5].resolve(); await tick();
  await c.route('#/buy');
  assert.match(c.d.body.textContent, /Restock/); assert.match(c.d.body.textContent, /Buy 5/); assert.match(c.d.body.textContent, /20.50/);
  c.click('[data-action="export"]');
  const csv = c.d.querySelector('#purchase-export').value;
  assert.match(csv, /Discs/); assert.match(csv, /80 grit/); assert.match(csv, /Buy box/);
  const state = fixture(); state.marks.push({ item_id: 'i2', ...c.requests[5].body });
  c.close();
  const reloaded = await client(state, '#/buy'); assert.match(reloaded.d.body.textContent, /Buy 5/); reloaded.close();
});
test('detail control limits match the API and reject oversized values before sending', async () => {
  const c = await client();
  for (const [field, max] of [['sp', 2000], ['n', 10000], ['q', 2147483647], ['c', 1e9]]) {
    const input = c.d.querySelector('[data-item-id="i2"] [data-field="' + field + '"]');
    const numeric = field === 'q' || field === 'c';
    assert.equal(input.getAttribute(numeric ? 'max' : 'maxlength'), String(max), field + ' HTML limit');
    const before = c.requests.length;
    input.value = numeric ? String(max + 1) : 'x'.repeat(max + 1);
    input.dispatchEvent(new c.w.Event('change', { bubbles: true }));
    assert.equal(c.requests.length, before, field + ' overflow never writes');
    assert.notEqual(input.validationMessage, '', field + ' gives validation feedback');
    input.value = numeric ? String(max) : 'x'.repeat(max);
    input.dispatchEvent(new c.w.Event('change', { bubbles: true }));
    assert.equal(input.validationMessage, '', field + ' valid correction clears error');
    assert.equal(c.requests.length, before + 1, field + ' inclusive maximum accepted');
    assert.equal(c.requests[before].body[field], numeric ? max : 'x'.repeat(max));
    c.requests[before].resolve(); await tick();
  }
  c.close();
});
test('unknown consumables excluded; NA overrides shortfall; invalid counts never write', async () => {
  const c = await client();
  const input = c.d.querySelector('[data-item-id="i2"] [data-field="q"]'); assert.ok(input);
  input.value = '-1'; input.dispatchEvent(new c.w.Event('change', { bubbles: true })); assert.equal(c.requests.length, 0);
  input.value = '1.5'; input.dispatchEvent(new c.w.Event('change', { bubbles: true })); assert.equal(c.requests.length, 0);
  await c.route('#/buy'); assert.ok(!c.d.querySelector('[data-item-id="i2"]'));
  c.close();
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'na', q: 0 });
  const na = await client(state, '#/buy'); assert.ok(!na.d.querySelector('[data-item-id="i2"]')); na.close();
});
test('desktop navigation, scoped direct search, deterministic groups and resume keep live controls stable', async () => {
  const c = await client(undefined, '#/');
  assert.ok(c.d.querySelector('header nav a[href="#/buy"]'), 'desktop buy link');
  const search = c.d.querySelector('#section-search'); search.focus(); search.value = 'Glasses'; search.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  assert.equal(c.d.querySelector('#section-search'), search, 'search is not replaced'); assert.equal(c.d.activeElement, search);
  const direct = c.d.querySelector('[data-search-item="i1"]'); assert.ok(direct, 'direct item result');
  direct.click(); await tick();
  assert.equal(c.d.querySelector('#item-search').value, '', 'home query does not leak');
  assert.deepEqual(Array.from(c.d.querySelectorAll('[data-subsection] h3'), n => n.textContent), ['Eyes', 'Stock']);
  assert.deepEqual(Array.from(c.d.querySelectorAll('[data-item-id]'), n => n.dataset.itemId), ['i1', 'i2']);
  c.click('[data-action="filter"][data-filter="missing"]');
  await c.route('#/section/s2'); assert.equal(c.d.querySelector('[data-action="filter"][data-filter="all"]').getAttribute('aria-pressed'), 'true');
  await c.route('#/'); assert.match(c.d.querySelector('[data-resume]').getAttribute('href'), /section\/s2/);
  c.close();
});
test('bulk previews visible bounded slice, serializes, reports partial failures and undoes as one group', async () => {
  const state = fixture();
  state.items = Array.from({ length: 25 }, (_, i) => ({ id: 'bulk' + String(i).padStart(2, '0'), subsection_id: 'b1', label: 'Stock ' + i, sort_order: i })); state.marks = [];
  const c = await client(state);
  c.click('[data-action="mark-all"]'); assert.equal(c.requests.length, 0, 'preview before effects');
  assert.match(c.d.querySelector('#bulk-feedback').textContent, /20/);
  c.click('[data-action="confirm-bulk"]'); assert.equal(c.requests.length, 1, 'bounded sequential requests');
  for (let i = 0; i < 20; i++) { assert.equal(c.requests.length, i + 1); c.requests[i].resolve(i === 3 ? 500 : 200); await tick(); }
  assert.match(c.d.querySelector('#bulk-feedback').textContent, /19 saved.*1 not saved/);
  assert.equal(c.requests.length, 20);
  c.click('[data-action="undo"]');
  assert.equal(c.requests.length, 21, 'bulk undo also sequential');
  for (let i = 20; i < 40; i++) { assert.equal(c.requests[i].body.status, 'unknown'); c.requests[i].resolve(); await tick(); }
  assert.equal(c.requests.length, 40);
  assert.equal(c.d.querySelector('[data-action="undo"]').disabled, true, 'one history group');
  c.close();
});
test('global save feedback stays truthful across routes, blocks unsaved export and rejects invalid success responses', async () => {
  const c = await client();
  c.click('[data-action="mark"][data-id="i1"]'); c.click('[data-action="mark"][data-id="i2"]');
  c.requests[0].resolve(); await tick();
  assert.match(c.d.querySelector('#write-summary').textContent, /1 saving/);
  await c.route('#/buy'); c.click('[data-action="export"]'); assert.match(c.d.querySelector('#export-result').textContent, /unavailable/);
  c.requests[1].resolve(500); await tick(); assert.match(c.d.querySelector('#write-summary').textContent, /1 not saved/);
  c.w.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>offline shell</html>' });
  c.click('[data-action="retry"][data-id="i2"]'); await tick();
  assert.match(c.d.querySelector('#write-summary').textContent, /1 not saved/);
  c.close();
});
test('count undo preserves newer note edits and versions come only from acknowledgments', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 4, n: 'Original', version: 7 });
  const c = await client(state);
  const q = c.d.querySelector('[data-item-id="i2"] [data-field="q"]'); q.value = '0'; q.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  assert.equal(c.requests[0].body.version, 7);
  c.requests[0].resolve(200, { ...c.requests[0].body, version: 8 }); await tick();
  c.click('[data-action="undo"]');
  assert.equal(c.requests[1].body.q, 4); assert.equal(c.requests[1].body.n, 'Original'); assert.equal(c.requests[1].body.version, 8);
  c.requests[1].resolve(200, { ...c.requests[1].body, version: 9 }); await tick();
  assert.equal(q.value, '4'); c.close();
});
test('conflicts require fresh cloud reload before edits or retry; numeric cost state remains writable', async () => {
  const state = fixture(); state.marks[0].c = '12.50'; state.marks[0].version = 2;
  const c = await client(state);
  c.click('[data-action="mark"][data-id="i1"]'); assert.equal(c.requests[0].body.c, 12.5);
  c.requests[0].resolve(409); await tick();
  c.click('[data-action="mark"][data-id="i1"]'); assert.equal(c.requests.length, 1, 'conflicted intent cannot be overwritten blindly');
  assert.ok(!c.d.querySelector('[data-action="retry"][data-id="i1"]'), 'no blind retry');
  state.marks[0] = { item_id: 'i1', status: 'blocking', n: 'Other device', version: 3 };
  c.click('[data-action="reload-cloud"]'); await tick();
  assert.equal(c.d.querySelector('[data-action="mark"][data-id="i1"]').dataset.status, 'blocking');
  c.click('[data-action="mark"][data-id="i1"]'); assert.equal(c.requests[1].body.version, 3); assert.equal(c.requests[1].body.n, 'Other device');
  c.requests[1].resolve(); await tick(); c.close();
});
test('undo during a delayed count write coalesces and six-state cycle has no popup', async () => {
  const c = await client();
  const q = c.d.querySelector('[data-item-id="i2"] [data-field="q"]'); q.value = '0'; q.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  c.click('[data-action="undo"]'); assert.equal(c.requests.length, 1);
  c.requests[0].resolve(); await tick(); assert.equal(c.requests[1].body.q, null); c.requests[1].resolve(); await tick();
  const selector = '[data-action="mark"][data-id="i1"]';
  for (const status of ['have', 'missing', 'upgrade', 'blocking', 'na', 'unknown']) { c.click(selector); assert.equal(c.d.querySelector(selector).dataset.status, status); c.requests[c.requests.length - 1].resolve(); await tick(); }
  assert.ok(!c.d.querySelector('.status-sheet, [role="dialog"]')); c.close();
});
test('deep item links reveal filtered targets and live purchase totals update without replacing rows', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 0, c: 20 });
  const c = await client(state);
  c.click('[data-action="filter"][data-filter="missing"]'); await c.route('#/');
  const search = c.d.querySelector('#section-search'); search.value = 'Glasses'; search.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  c.click('[data-search-item="i1"]'); await tick();
  assert.equal(c.d.activeElement.dataset.id, 'i1', 'direct item gets keyboard focus');
  await c.route('#/buy'); const row = c.d.querySelector('[data-item-id="i2"]');
  c.click('[data-action="mark"][data-id="i2"]'); c.requests[0].resolve(); await tick();
  assert.equal(c.d.querySelector('[data-item-id="i2"]'), row, 'rapid cycling keeps row stable');
  assert.match(c.d.querySelector('#purchase-totals').textContent, /1 lines/);
  c.click('[data-action="mark"][data-id="i2"]'); c.requests[1].resolve(); await tick();
  c.click('[data-action="mark"][data-id="i2"]'); c.requests[2].resolve(); await tick();
  c.click('[data-action="mark"][data-id="i2"]'); c.requests[3].resolve(); await tick();
  assert.match(c.d.querySelector('#purchase-totals').textContent, /0 lines/);
  assert.match(row.textContent, /No longer on buy list/); c.close();
});
test('delayed logout exposes no editable form and only confirmed success renders a stable login', async () => {
  const c = await client();
  c.click('[data-action="mark"][data-id="i1"]'); c.click('[data-action="mark"][data-id="i1"]');
  let finishLogout; let logoutCalls = 0;
  c.w.fetch = async () => { logoutCalls++; return new Promise(resolve => { finishLogout = () => resolve(response({ ok: true })); }); };
  c.click('[data-action="logout"]');
  assert.match(c.d.body.textContent, /Signing out/);
  assert.equal(c.d.querySelector('#app').querySelector('input, form, button, textarea'), null, 'no form to type into before logout acknowledgment');
  await c.route('#/settings');
  c.requests[0].resolve(); await tick();
  assert.equal(c.requests.length, 1, 'old write acknowledgment cannot pump coalesced intent');
  assert.equal(c.d.querySelector('#auth-form'), null);
  finishLogout(); await tick();
  assert.match(c.d.body.textContent, /You are signed out/);
  const form = c.d.querySelector('#auth-form'); assert.ok(form);
  form.elements.namedItem('email').value = 'new@example.test';
  await c.route('#/buy'); await tick();
  assert.equal(c.d.querySelector('#auth-form'), form, 'confirmed login renders once');
  assert.equal(form.elements.namedItem('email').value, 'new@example.test');
  assert.equal(logoutCalls, 1); c.close();
});
test('logout invalidates pending writes and failures do not claim confirmed sign-out', async () => {
  const c = await client();
  c.click('[data-action="mark"][data-id="i1"]');
  const existingFetch = c.w.fetch;
  c.w.fetch = async (url, options) => url.endsWith('/password-logout') ? response({ error: 'offline' }, 500) : existingFetch(url, options);
  c.click('[data-action="logout"]'); await tick();
  assert.match(c.d.body.textContent, /Could not confirm sign-out/);
  assert.match(c.d.body.textContent, /sign in again to recover access/);
  assert.doesNotMatch(c.d.body.textContent, /You are signed out/);
  c.requests[0].resolve(); await tick(); await c.route('#/buy'); assert.ok(c.d.querySelector('#auth-form'));
  let finishRetry;
  c.w.fetch = async () => new Promise(resolve => { finishRetry = () => resolve(response({ ok: true })); });
  c.click('[data-action="logout"]');
  assert.equal(c.d.querySelector('#auth-form'), null, 'retry is also noninteractive while pending');
  finishRetry(); await tick(); assert.match(c.d.body.textContent, /You are signed out/);
  assert.ok(c.d.querySelector('#auth-form')); c.close();
});
test('purchase search is independently scoped and structural editing is explicitly deferred', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'have', q: 0 }); state.marks[0].status = 'missing';
  const c = await client(state, '#/buy');
  const search = c.d.querySelector('#buy-search'); assert.ok(search); search.value = 'Discs'; search.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  assert.equal(c.d.querySelector('#buy-search'), search); assert.ok(!c.d.querySelector('[data-item-id="i1"]')); assert.ok(c.d.querySelector('[data-item-id="i2"]'));
  await c.route('#/section/s1'); assert.equal(c.d.querySelector('#item-search').value, '');
  await c.route('#/settings'); assert.match(c.d.body.textContent, /Checklist structure editing is deferred/); c.close();
});
test('blank details explicitly clear, export neutralizes formulas, and history stays bounded at 30', async () => {
  const state = fixture(); state.marks[0].status = 'missing'; state.items.find(x => x.id === 'i1').label = '=HYPERLINK("unsafe")';
  const c = await client(state);
  const n = c.d.querySelector('[data-item-id="i1"] [data-field="n"]'); n.value = ''; n.dispatchEvent(new c.w.Event('change', { bubbles: true }));
  assert.equal(c.requests[0].body.n, null); c.requests[0].resolve(); await tick();
  for (let i = 0; i < 35; i++) { c.click('[data-action="mark"][data-id="i1"]'); c.requests[c.requests.length - 1].resolve(); await tick(); }
  for (let i = 0; i < 30; i++) { c.click('[data-action="undo"]'); c.requests[c.requests.length - 1].resolve(); await tick(); }
  assert.equal(c.d.querySelector('[data-action="undo"]').disabled, true);
  // Use a fresh confirmed fixture to isolate CSV escaping from cycle arithmetic.
  c.close(); const exported = await client(state, '#/buy'); exported.click('[data-action="export"]');
  assert.match(exported.d.querySelector('#purchase-export').value, /'=HYPERLINK/); exported.close();
});
test('an obsolete reload response after sign-out cannot repopulate private navigation', async () => {
  const c = await client(); c.click('[data-action="mark"][data-id="i1"]'); c.requests[0].resolve(500); await tick();
  let finishReload;
  c.w.fetch = async url => url.endsWith('/state') ? new Promise(resolve => { finishReload = () => resolve(response(fixture())); }) : response({ ok: true });
  c.click('[data-action="reload-cloud"]'); c.click('[data-action="logout"]'); await tick(); finishReload(); await tick();
  assert.doesNotMatch(c.d.querySelector('#live').textContent, /Reloaded cloud/); assert.match(c.d.body.textContent, /signed out/); assert.ok(c.d.querySelector('#auth-form')); await c.route('#/section/s1'); assert.ok(c.d.querySelector('#auth-form')); c.close();
});
test('session-expiry sign-in reloads cloud state without replaying failed intent', async () => {
  const c = await client(); c.click('[data-action="mark"][data-id="i1"]'); c.requests[0].resolve(401); await tick();
  const state = fixture(); state.marks[0].status = 'blocking';
  const calls = [];
  c.w.fetch = async (url) => { calls.push(url); return url.endsWith('/password-login') ? response({ user: { email: 'qa@example.test' }, workspace: { id: 'w1', name: 'QA' } }) : response(state); };
  const form = c.d.querySelector('#auth-form'); form.elements.namedItem('email').value = 'qa@example.test'; form.elements.namedItem('password').value = 'fixture-only-not-real';
  form.dispatchEvent(new c.w.Event('submit', { bubbles: true, cancelable: true })); await tick(); await c.route('#/section/s1');
  assert.equal(c.d.querySelector('[data-action="mark"][data-id="i1"]').dataset.status, 'blocking'); assert.equal(calls.filter(x => x.includes('/marks/')).length, 0); c.close();
});
test('bulk preserves metadata and skips an item changed after preview before its turn', async () => {
  const state = fixture(); state.marks.push({ item_id: 'i2', status: 'unknown', q: 2, sp: 'Fine', n: 'Box', c: 7 });
  const c = await client(state);
  c.click('[data-action="mark-all"]'); c.click('[data-action="confirm-bulk"]');
  assert.deepEqual(c.requests[0].body, { status: 'have', q: 2, sp: 'ANSI', n: 'Blue pair', c: 12.5, version: 0 });
  c.click('[data-action="mark"][data-id="i2"]'); c.click('[data-action="mark"][data-id="i2"]');
  c.requests[1].resolve(); await tick(); c.requests[2].resolve(); await tick();
  c.requests[0].resolve(); await tick();
  assert.equal(c.requests.length, 3, 'batch must not replace a later manual choice');
  assert.equal(c.d.querySelector('[data-action="mark"][data-id="i2"]').dataset.status, 'missing'); c.close();
});
test('delayed acknowledgment preserves newer edits and undo preserves acknowledged metadata', async () => {
  const c = await client();
  const change = (field, value) => { const el = c.d.querySelector('[data-item-id="i2"] [data-field="' + field + '"]'); el.value = value; el.dispatchEvent(new c.w.Event('change', { bubbles: true })); };
  change('q', '0'); change('n', 'New note');
  c.requests[0].resolve(200, { ...c.requests[0].body, version: 1, sp: 'Acknowledged spec', c: '7.50' }); await tick();
  assert.equal(c.requests[1].body.n, 'New note');
  assert.equal(c.requests[1].body.sp, 'Acknowledged spec');
  assert.equal(c.requests[1].body.c, 7.5);
  assert.equal(c.requests[1].body.version, 1);
  c.click('[data-action="undo"]');
  c.requests[1].resolve(); await tick();
  assert.equal(c.requests[2].body.n, null, 'undo note while save is delayed');
  assert.equal(c.requests[2].body.sp, 'Acknowledged spec');
  assert.equal(c.requests[2].body.version, 2);
  c.requests[2].resolve(); await tick();
  c.click('[data-action="undo"]');
  assert.equal(c.requests[3].body.q, null);
  assert.equal(c.requests[3].body.sp, 'Acknowledged spec');
  assert.equal(c.requests[3].body.c, 7.5);
  assert.equal(c.requests[3].body.version, 3);
  c.requests[3].resolve(); await tick(); c.close();
});
test('a delayed conflict reload is required before any queued retry and uses fetched mark versions', async () => {
  const state = fixture(); state.marks[0].version = 9;
  const c = await client(state);
  const selector = '[data-action="mark"][data-id="i1"]';
  c.click(selector); c.click(selector);
  c.requests[0].resolve(409); await tick();
  assert.equal(c.requests.length, 1, 'coalesced intent is not replayed after conflict');
  c.click('[data-action="undo"]'); assert.equal(c.requests.length, 1);
  const fetch = c.w.fetch; let finishReload;
  c.w.fetch = async (url, options) => url.endsWith('/state') ? new Promise(resolve => { finishReload = () => resolve(response({ ...state, revision: 8000, marks: [{ item_id: 'i1', status: 'have', q: 3, sp: 'Cloud spec', n: 'Cloud note', c: '6.25', version: 14 }] })); }) : fetch(url, options);
  c.click('[data-action="reload-cloud"]'); c.click(selector);
  assert.equal(c.requests.length, 1, 'reload blocks new writes');
  finishReload(); await tick(); c.click(selector);
  assert.equal(c.requests[1].body.version, 14, 'read server mark version, not local or workspace revision');
  assert.equal(c.requests[1].body.n, 'Cloud note'); assert.equal(c.requests[1].body.c, 6.25);
  c.requests[1].resolve(); await tick(); c.close();
});
test('retry cannot race an outstanding cloud reload', async () => {
  const c = await client(); c.click('[data-action="mark"][data-id="i1"]'); c.requests[0].resolve(500); await tick();
  const fetch = c.w.fetch; let finishReload;
  c.w.fetch = async (url, options) => url.endsWith('/state') ? new Promise(resolve => { finishReload = () => resolve(response(fixture())); }) : fetch(url, options);
  c.click('[data-action="reload-cloud"]'); c.click('[data-action="retry"][data-id="i1"]');
  assert.equal(c.requests.length, 1, 'no write may begin while snapshot is being read');
  finishReload(); await tick(); c.close();
});
test('an acknowledgment without a server mark version remains unsaved', async () => {
  const c = await client(); c.click('[data-action="mark"][data-id="i1"]');
  const { version, ...mark } = c.requests[0].body;
  c.requests[0].resolve(200, mark); await tick();
  assert.match(c.d.querySelector('#write-summary').textContent, /1 not saved/);
  assert.equal(c.requests.length, 1, 'no automatic retry on invalid acknowledgment'); c.close();
});
test('SQL nullable statuses normalize to unknown but malformed acknowledgment statuses fail', async () => {
  const c = await client(); c.click('[data-action="mark"][data-id="i1"]');
  c.requests[0].resolve(200, { ...c.requests[0].body, status: null, version: 1 }); await tick();
  assert.equal(c.d.querySelector('[data-action="mark"][data-id="i1"]').dataset.status, 'unknown');
  assert.match(c.d.querySelector('#write-summary').textContent, /All changes saved/); c.close();
  for (const status of [undefined, '', false]) {
    const bad = await client(); bad.click('[data-action="mark"][data-id="i1"]');
    bad.requests[0].resolve(200, { ...bad.requests[0].body, status, version: 1 }); await tick();
    assert.match(bad.d.querySelector('#write-summary').textContent, /1 not saved/); bad.close();
  }
});
test('offline search never re-enables editing and reconnect does not replay changes', async () => {
  const c = await client();
  Object.defineProperty(c.w.navigator, 'onLine', { configurable: true, value: false }); c.w.dispatchEvent(new c.w.Event('offline'));
  const search = c.d.querySelector('#item-search'); search.value = 'Discs'; search.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  assert.equal(c.d.querySelector('[data-field="q"]').disabled, true); assert.equal(c.d.querySelector('[data-action="mark"]').disabled, true);
  Object.defineProperty(c.w.navigator, 'onLine', { configurable: true, value: true }); c.w.dispatchEvent(new c.w.Event('online')); await tick(); assert.equal(c.requests.length, 0); c.close();
});
(async () => { for (const [name, fn] of tests) { await fn(); console.log('PASS', name); } console.log(`${tests.length} active-client workflow tests passed`); })().catch(error => { console.error(error); process.exitCode = 1; });
