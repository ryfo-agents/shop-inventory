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
      const file = path.resolve(script.getAttribute('src').replace(/^\//, ''));
      assert.ok(file.startsWith(path.resolve('greenfield') + path.sep), 'root loads supported client assets');
      dom.window.eval(fs.readFileSync(file, 'utf8'));
    }
    const deadline = Date.now() + 3000;
    while (!dom.window.document.querySelector('#auth-form') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(dom.window.document.querySelector('#auth-form'), 'root client auth form rendered');
  } finally { dom.window.close(); await fixture.close(); }
});
