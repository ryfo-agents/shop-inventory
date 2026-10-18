const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('greenfield/index.html', 'utf8');
const script = fs.readFileSync('greenfield/app.js', 'utf8');

async function run() {
  const dom = new JSDOM(html, { url: 'http://localhost:8899/greenfield/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: 'not_authenticated' }) });
  window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(window.document.body.textContent, /Make the next audit easy/);
  assert.ok(window.document.querySelector('#auth-form'));
  const authFetch = async (url, options) => {
    if (url.endsWith('/api/auth/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { email: 'qa@example.test' }, workspace: { id: 'w1', name: 'QA' } }) };
    if (url.includes('/state')) return { ok: true, status: 200, text: async () => JSON.stringify({ sections: [{ id: 's1', num: 1, title: 'Safety', sort_order: 0, deleted: false }], subsections: [{ id: 'b1', section_id: 's1', num: '1.1', title: 'Eyes', sort_order: 0, deleted: false }], items: [{ id: 'i1', subsection_id: 'b1', label: 'Glasses', store: 'General', sort_order: 0, deleted: false }], marks: [] }) };
    if (url.includes('/marks/')) return { ok: true, status: 200, text: async () => JSON.stringify({ mark: { status: JSON.parse(options.body).status, updated_at: new Date().toISOString() } }) };
    throw new Error('unexpected request ' + url);
  };
  const loggedIn = new JSDOM(html, { url: 'http://localhost:8899/', runScripts: 'outside-only', pretendToBeVisual: true });
  loggedIn.window.fetch = authFetch;
  loggedIn.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 30));
  loggedIn.window.document.querySelector('a.section-card').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const status = loggedIn.window.document.querySelector('button.status-button');
  assert.strictEqual(status.dataset.status, 'unknown');
  status.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(loggedIn.window.document.querySelector('button.status-button').dataset.status, 'have');
  await new Promise(resolve => setTimeout(resolve, 10));
  loggedIn.window.document.querySelector('button.status-button').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(loggedIn.window.document.querySelector('button.status-button').dataset.status, 'missing');
  const mobile = new JSDOM(html, { url: 'http://localhost:8899/', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.defineProperty(mobile.window, 'innerWidth', { value: 390, configurable: true });
  mobile.window.fetch = authFetch;
  mobile.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 30));
  mobile.window.document.querySelector('a.section-card').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  mobile.window.document.querySelector('button.status-button').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(mobile.window.document.querySelector('button.status-button').dataset.status, 'have');
  await new Promise(resolve => setTimeout(resolve, 10));
  mobile.window.document.querySelector('button.status-button').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(mobile.window.document.querySelector('button.status-button').dataset.status, 'missing');
  assert.ok(!mobile.window.document.querySelector('.status-sheet'));
  console.log('GREENFIELD MOBILE SINGLE-TAP CHECK PASSED');
}

run().catch(error => { console.error(error); process.exit(1); });
