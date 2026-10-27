/* Optional, isolated local evidence: NODE_PATH=<playwright+axe-core modules> node tests/mobile-browser.js
 * No browser profile, credentials, external API or real inventory is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.PWA_EVIDENCE_DIR || path.join(process.env.HOME, '.hermes/cache/scratch/shop-pwa-evidence');
const state = {
  sections: [{ id: 's1', num: 1, title: 'Safety and workshop equipment', sort_order: 0 }],
  subsections: [{ id: 'b1', section_id: 's1', num: '1.1', title: 'Eye protection', sort_order: 0 }],
  items: Array.from({ length: 30 }, (_, i) => ({ id: 'i' + i, subsection_id: 'b1', label: i ? 'Workshop fixture ' + i : 'Protective glasses with a long descriptive label', store: 'Fixture store', sort_order: i })),
  marks: []
};
let authenticated = true, account = 'A';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!authenticated) { res.writeHead(401); res.end(JSON.stringify({ error: 'not_authenticated' })); return; }
    if (url.pathname === '/api/auth/me') { res.end(JSON.stringify({ user: { email: 'fixture-' + account + '@example.test' }, workspace: { id: 'w1', name: 'Isolated mobile fixture ' + account } })); return; }
    if (url.pathname.endsWith('/state')) { res.end(JSON.stringify(state)); return; }
    if (url.pathname.includes('/marks/') && req.method === 'PUT') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const mark = { ...JSON.parse(Buffer.concat(chunks)), item_id: url.pathname.split('/').pop(), updated_at: new Date().toISOString() };
      state.marks = state.marks.filter(m => m.item_id !== mark.item_id).concat(mark);
      res.end(JSON.stringify({ mark })); return;
    }
    res.writeHead(404); res.end('{}'); return;
  }
  const requested = decodeURIComponent(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname);
  const file = path.resolve(root, '.' + requested);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(file));
});

async function layout(page, label, records) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
    clippedBrand: [...document.querySelectorAll('.brand-mark')].some(e => parseFloat(getComputedStyle(e).lineHeight) > e.getBoundingClientRect().height),
    smallFields: [...document.querySelectorAll('input,textarea,select')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).length,
    smallButtons: [...document.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width > 0 && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => e.textContent),
    locked: [...document.querySelectorAll('*')].some(e => getComputedStyle(e).touchAction === 'none')
  }));
  records.push({ label, ...metrics });
  assert.ok(metrics.scrollWidth <= metrics.width + 1, label + ' horizontal overflow: ' + JSON.stringify(metrics));
  assert.equal(metrics.smallFields, 0, label + ' input text smaller than 16px');
  assert.deepEqual(metrics.smallButtons, [], label + ' undersized buttons');
  assert.equal(metrics.locked, false, label + ' blocks touch scrolling');
  assert.equal(metrics.clippedBrand, false, label + ' clips enlarged brand text');
  if (label.includes('200-percent')) assert.ok(metrics.bodyFont >= 32, label + ' body text did not resize');
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const page = await context.newPage();
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        authenticated = true; account = 'A'; state.marks = [];
        // Seed only disposable Cache Storage, on this ephemeral local origin.
        await page.goto(origin + '/icons/icon-192.png');
        await page.evaluate(async () => { const c = await caches.open('shop-inv-v9'); await c.put('/api/auth/me', new Response('private-old-fixture')); });
        await page.goto(origin + '/');
        await page.locator('.section-card').waitFor();
        await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })); });
        const keys = await page.evaluate(() => caches.keys());
        assert.deepEqual(keys, ['shop-inv-shell-v10']);
        const cached = await page.evaluate(async () => { const c = await caches.open('shop-inv-shell-v10'); return (await c.keys()).map(r => r.url); });
        assert.equal(cached.length, 7); assert.ok(cached.every(url => !url.includes('/api')));
        account = 'B';
        assert.equal(await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user.email), 'fixture-B@example.test');
        for (const width of [320, 390, 844, 1280]) {
          await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
          for (const route of ['#/', '#/section/s1', '#/buy', '#/settings']) {
            await page.goto(origin + '/' + route); await page.locator('main h1').waitFor();
            await layout(page, name + '-' + width + '-' + route, results);
          }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(origin + '/#/section/s1'); await page.locator('.status-button').first().waitFor();
        const statuses = ['have', 'missing', 'upgrade', 'blocking', 'na', 'unknown'];
        for (const status of statuses) {
          await page.locator('.status-button').first().tap();
          await page.waitForFunction(s => document.querySelector('.status-button').dataset.status === s, status);
          await page.waitForFunction(() => !document.querySelector('.item-status').textContent.includes('Saving'));
          assert.equal(state.marks.find(m => m.item_id === 'i0').status, status);
        }
        assert.equal(await page.locator('[role=dialog], .status-sheet').count(), 0);
        assert.equal(await page.evaluate(() => visualViewport.scale), 1, name + ' taps changed viewport zoom');
        await page.locator('.status-button').first().focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('.status-button').dataset.status === 'have');
        if (name === 'chromium') {
          const cdp = await context.newCDPSession(page);
          const box = await page.locator('.status-button').first().boundingBox();
          const beforeScroll = await page.evaluate(() => scrollY);
          await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: -220, gestureSourceType: 'touch' });
          await page.waitForFunction(before => scrollY > before + 50, beforeScroll);
          await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 400, scaleFactor: 1.5, relativeSpeed: 400, gestureSourceType: 'touch' });
          await page.waitForFunction(() => visualViewport.scale > 1.2);
          results.push({ label: 'chromium-emulated-gestures', scrollFromStatusButton: true, pinchScale: await page.evaluate(() => visualViewport.scale) });
          await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
          await cdp.detach();
          await page.evaluate(() => scrollTo(0, 0));
        }
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const accessibility = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
        results.push({ label: name + '-a11y-section', violations: accessibility });
        assert.deepEqual(accessibility.filter(v => ['serious', 'critical'].includes(v.impact)), [], name + ' accessibility');
        await page.screenshot({ path: path.join(output, name + '-phone.png'), fullPage: true });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await layout(page, name + '-200-percent-text', results);
        await page.screenshot({ path: path.join(output, name + '-large-text.png') });
        await page.setViewportSize({ width: 320, height: 844 });
        for (const route of ['#/', '#/section/s1', '#/buy', '#/settings']) {
          await page.evaluate(hash => { location.hash = hash; }, route);
          await page.waitForTimeout(50);
          await layout(page, name + '-320-200-percent-' + route, results);
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        authenticated = false;
        await page.reload(); await page.locator('#auth-form').waitFor();
        await layout(page, name + '-auth', results);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const authAccessibility = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact })));
        results.push({ label: name + '-a11y-auth', violations: authAccessibility });
        assert.deepEqual(authAccessibility.filter(v => ['serious', 'critical'].includes(v.impact)), [], name + ' auth accessibility');
        await page.locator('input[name=email]').focus();
        assert.equal(await page.locator('input[name=email]').evaluate(e => e === document.activeElement), true);
        assert.deepEqual(errors, [], name + ' uncaught online JS errors');
        await context.setOffline(true);
        await page.locator('#pwa-network').filter({ hasText: 'Offline' }).waitFor();
        assert.equal(await page.evaluate(() => fetch('/api/auth/me').then(() => false, () => true)), true);
        await page.reload(); await page.locator('#auth-form').waitFor();
        assert.match(await page.locator('#pwa-network').textContent(), /Offline/);
        assert.doesNotMatch(await page.locator('#app').textContent(), /fixture-[AB]@/);
        await context.setOffline(false);
        await page.locator('#pwa-network').filter({ hasText: 'Connection restored' }).waitFor();
        // WebKit reports deliberately rejected SW fetches as page errors as well as
        // rejecting the caller's fetch promise. Keep this evidence; do not hide it.
        assert.ok(errors.every(e => e === 'TypeError: Load failed' || e.endsWith('/api/auth/me.')), name + ' unexpected offline errors');
        results.push({ label: name + '-worker-and-gestures', cacheEntries: cached.length, accountSwitch: true, offlineApiRejected: true, offlineShell: true, sixTapCycle: true, keyboard: true, onlineUncaughtErrors: [], offlineWorkerErrors: errors });
      } finally { await context.close(); await browser.close(); }
    }
  } finally {
    server.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log('Evidence: ' + output);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
