const { test } = require('node:test');
const assert = require('node:assert/strict');

test('isolated HTTP fixture authenticates, persists marks and rejects cross-account reads', async () => {
  const { startFixture } = require('../browser/fixture-server');
  const fixture = await startFixture();
  try {
    const url = fixture.url;
    assert.equal((await fetch(url + '/api/auth/me')).status, 401);
    const login = await fetch(url + '/api/auth/password-login', { method: 'POST', body: JSON.stringify({ email: 'alpha@example.test', password: 'fixture-password-only' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url + '/api/workspaces/beta/state', { headers })).status, 403);
    const response = await fetch(url + '/api/workspaces/alpha/marks/alpha-item', { method: 'PUT', headers, body: JSON.stringify({ status: 'missing' }) });
    assert.equal(response.status, 200);
    const state = await (await fetch(url + '/api/workspaces/alpha/state', { headers })).json();
    assert.equal(state.marks[0].status, 'missing');
    assert.equal(state.marks[0].n, 'Alpha private fixture note');
    assert.equal((await fetch(url + '/.env')).status, 404);
  } finally { await fixture.close(); }
});
