const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { startFixture } = require('../browser/fixture-server');

test('deployed root HTML loads its actual client and presents authentication (HTTP fixture, not real API)', async () => {
  const fixture = await startFixture();
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: fixture.url, runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const scripts = [...dom.window.document.querySelectorAll('script[src]')];
    assert.ok(scripts.length > 0, 'root must load shipped client');
    dom.window.fetch = (url, options) => fetch(new URL(url, fixture.url), options);
    for (const script of scripts) {
      const asset = new URL(script.getAttribute('src'), fixture.url);
      assert.equal(asset.origin, fixture.url, 'root loads same-origin assets');
      const file = path.resolve('.' + decodeURIComponent(asset.pathname));
      assert.ok(file.startsWith(path.resolve('greenfield') + path.sep), 'root loads supported client assets');
      dom.window.eval(fs.readFileSync(file, 'utf8'));
    }
    const deadline = Date.now() + 3000;
    while (!dom.window.document.querySelector('#auth-form') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(dom.window.document.querySelector('#auth-form'), 'root client auth form rendered');
  } finally { dom.window.close(); await fixture.close(); }
});

test('QA fixture requires mark version and returns workspace revision in GET state', async () => {
  const fixture = await startFixture();
  try {
    const login = await fetch(fixture.url + '/api/auth/password-login', { method: 'POST', body: JSON.stringify({ email: 'alpha@example.test', password: 'fixture-password-only' }) });
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    const state = async () => (await fetch(fixture.url + '/api/workspaces/alpha/state', { headers })).json();
    const write = body => fetch(fixture.url + '/api/workspaces/alpha/marks/alpha-item', { method: 'PUT', headers, body: JSON.stringify(body) });
    const initial = await state();
    assert.equal(initial.revision, 0);
    assert.equal(initial.marks[0].version, 1);
    for (const [body, status, error] of [
      [{ status: 'have' }, 428, 'precondition_required'],
      [{ status: 'have', revision: 1 }, 400, 'invalid_mark'],
      [{ status: 'have', version: -1 }, 400, 'invalid_version'],
      [{ status: 'bad', version: 1 }, 400, 'invalid_status'],
      [{ status: 'have', version: 0 }, 409, 'revision_conflict']
    ]) {
      const response = await write(body);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
      assert.deepEqual(await state(), initial, 'rejected writes must not mutate state');
    }
    const response = await write({ status: 'missing', version: 1 });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.mark.version, 2);
    assert.equal(saved.revision, 1);
    assert.equal(saved.mark.status, 'missing');
    assert.equal(saved.mark.n, initial.marks[0].n);
    assert.equal(Object.hasOwn(saved.mark, 'revision'), false);
    const snapshot = await state();
    assert.equal(snapshot.revision, saved.revision);
    assert.deepEqual(snapshot.marks[0], saved.mark);
    const conflict = await write({ status: 'have', version: 1 });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: 'revision_conflict' });
    assert.deepEqual(await state(), snapshot);
  } finally { await fixture.close(); }
});
