const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['index.html', 'greenfield/index.html']) {
  test(file + ' preserves user zoom and pins the same public shell version', () => {
    const doc = new JSDOM(read(file)).window.document;
    const viewport = doc.querySelector('meta[name=viewport]').content;
    assert.doesNotMatch(viewport, /maximum-scale|user-scalable\s*=\s*no/);
    assert.match(viewport, /viewport-fit=cover/);
    assert.match(doc.querySelector('link[rel=stylesheet]').href, /\?v=10$/);
    assert.match(doc.querySelector('script[src]').src, /\?v=10$/);
    assert.ok(doc.querySelector('link[rel=manifest]'));
    assert.ok(doc.querySelector('link[rel=apple-touch-icon]'));
  });
}

test('mobile CSS preserves pan/pinch, accessible field text and safe-area support', () => {
  const css = read('greenfield/styles.css');
  assert.doesNotMatch(css, /touch-action:\s*none/);
  assert.match(css, /input, select, textarea\s*\{[^}]*font-size:\s*max\(16px, 1rem\)/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /prefers-reduced-motion/);
});

test('manifest retains a stable install identity, standalone shell and real icon files', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#111817');
  for (const icon of manifest.icons) {
    const image = fs.readFileSync(path.join(root, icon.src));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    assert.equal(icon.sizes, image.readUInt32BE(16) + 'x' + image.readUInt32BE(20));
  }
});

test('entrypoint update/network scripts remain identical', () => {
  const inline = file => [...new JSDOM(read(file)).window.document.scripts].find(s => s.textContent.includes('serviceWorker')).textContent;
  assert.equal(inline('index.html'), inline('greenfield/index.html'));
});

function shell({ online = true, controlled = true, registrationFails = false } = {}) {
  const dom = new JSDOM(read('index.html'), { url: 'https://shop.test/', runScripts: 'outside-only' });
  const w = dom.window;
  let registerOptions;
  Object.defineProperty(w.navigator, 'onLine', { value: online, configurable: true });
  const sw = new w.EventTarget();
  sw.controller = controlled ? {} : null;
  sw.register = (_url, options) => {
    registerOptions = options;
    return registrationFails ? Promise.reject(new Error('blocked')) : Promise.resolve({ update: () => Promise.resolve() });
  };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: sw });
  const code = [...w.document.scripts].find(s => s.textContent.includes('serviceWorker')).textContent;
  w.eval(code);
  return { w, sw, get options() { return registerOptions; } };
}

test('offline and reconnect cues survive application rerenders without auto retry', () => {
  const { w, options } = shell({ online: false });
  const cue = w.document.querySelector('#pwa-network');
  assert.equal(cue.hidden, false);
  assert.match(cue.textContent, /Offline.*connection/);
  w.document.querySelector('#app').innerHTML = '<main>Fixture</main>';
  Object.defineProperty(w.navigator, 'onLine', { value: true });
  w.dispatchEvent(new w.Event('online'));
  assert.match(cue.textContent, /restored.*[Rr]etry/);
  assert.equal(options.updateViaCache, 'none');
  w.close();
});

test('worker upgrade offers an inline cue, never forces a reload or status popup', () => {
  const { w, sw } = shell();
  const cue = w.document.querySelector('#pwa-update');
  assert.equal(cue.hidden, true);
  sw.dispatchEvent(new w.Event('controllerchange'));
  assert.equal(cue.hidden, false);
  assert.match(cue.textContent, /saving.*reload/i);
  assert.ok(cue.querySelector('button'));
  assert.equal(w.document.querySelector('[role=dialog]'), null);
  w.close();
});

test('first worker install does not claim an update is needed', () => {
  const { w, sw } = shell({ controlled: false });
  sw.dispatchEvent(new w.Event('controllerchange'));
  assert.equal(w.document.querySelector('#pwa-update').hidden, true);
  w.close();
});

test('registration failure is visible rather than an unhandled rejection', async () => {
  const { w } = shell({ registrationFails: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(w.document.querySelector('#pwa-network').textContent, /Offline shell unavailable/);
  w.close();
});
