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
  window.document.querySelector('[data-action="toggle-auth"]').click();
  assert.ok(window.document.querySelector('input[name="displayName"]'));
  console.log('GREENFIELD AUTH CHECK PASSED');
}

run().catch(error => { console.error(error); process.exit(1); });
