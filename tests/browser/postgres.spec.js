const { test: base, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { startPostgresServer } = require('./postgres-server');

// Normal in-memory browser gate remains usable without PG. Release must set the
// explicit opt-in and invoke this file (or playwright.postgres.config.js).
const test = base.extend({
  real: async ({}, use) => {
    const server = await startPostgresServer();
    try { await use(server); } finally { await server.close(); }
  },
  baseURL: async ({ real }, use) => use(real.url),
});
test.use({ ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
test.skip(!process.env.BACKEND_TEST_DATABASE_URL, 'Real PostgreSQL browser acceptance requires explicit loopback BACKEND_TEST_DATABASE_URL; no DATABASE_URL fallback');
test.setTimeout(90000);
const password = 'real-postgres-browser-password';

async function request(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }, { path, method, body });
}
async function enter(page, email, register = true, navigate = true) {
  if (navigate) await page.goto('/');
  if (register) await page.getByRole('button', { name: 'Create a new account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (register) await page.getByLabel('Name', { exact: true }).fill('Real browser acceptance');
  await page.getByRole('button', { name: register ? 'Create workspace' : 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Know what is in the shop.' })).toBeVisible();
  const me = await request(page, '/api/auth/me');
  expect(me.status).toBe(200);
  const state = await request(page, '/api/workspaces/' + me.body.workspace.id + '/state');
  expect(state.status).toBe(200);
  return { ...me.body, state: state.body };
}
async function openItem(page, state, item) {
  const sub = state.subsections.find(sub => sub.id === item.subsection_id);
  await page.goto('/#/section/' + encodeURIComponent(sub.section_id));
  const row = page.locator('.item-row').filter({ has: page.locator('[data-action="mark"][data-id=' + JSON.stringify(item.id) + ']') });
  await expect(row).toBeVisible();
  return row;
}
async function saved(row) { await expect(row.locator('.item-status')).toHaveText('Saved'); }
async function markInDatabase(real, itemId) {
  return (await real.pg.query('SELECT status,q,sp,n,c::float8 AS c,version::int FROM marks WHERE item_id=$1', [itemId])).rows[0];
}
async function noPrivateCache(page) {
  // Do not claim cache privacy from a browser where SW never activated.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys(), privateURLs = [];
    for (const name of names) for (const request of await (await caches.open(name)).keys()) {
      if (new URL(request.url).pathname.startsWith('/api/')) privateURLs.push(request.url);
    }
    return { names, privateURLs };
  });
  expect(cached.names.length).toBeGreaterThan(0);
  expect(cached.privateURLs).toEqual([]);
}
async function axe(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

test('real HTTPS registration, Secure HttpOnly session, seeded1534 and password login', async ({ page, context, real }) => {
  const session = await enter(page, 'auth@example.test');
  expect(session.state.items).toHaveLength(1534);
  expect(session.state.sections).toHaveLength(19);
  expect(session.state.subsections).toHaveLength(100);
  expect(session.state.revision).toBe(1);
  expect(await real.pg.query('SELECT count(*)::int AS n FROM items')).toMatchObject({ rows: [{ n: 1534 }] });
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'shop_session');
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('shop_session');
  const account = (await real.pg.query('SELECT password_hash FROM users WHERE email=$1', ['auth@example.test'])).rows[0];
  expect(account.password_hash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await expect(page.getByRole('alert')).toHaveText('You are signed out.');
  expect((await request(page, '/api/auth/me')).status).toBe(401);
  const again = await enter(page, 'auth@example.test', false);
  expect(again.workspace.id).toBe(session.workspace.id);
  expect(again.state.revision).toBe(1);
  expect((await real.pg.query('SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NOT NULL')).rows[0].n).toBe(1);
  await noPrivateCache(page);
});

test('delayed real writes keep latest rapid-tap intent across reload and an independent login', async ({ page, browser, real }) => {
  const session = await enter(page, 'rapid@example.test');
  const item = session.state.items[0];
  const row = await openItem(page, session.state, item);
  const button = row.locator('.status-button');
  await expect(button).toHaveAttribute('data-status', 'unknown');
  real.delayNextMark(800);
  await button.click();
  await button.click();
  await expect(button).toHaveAttribute('data-status', 'missing');
  await saved(row);
  const writes = real.requests.filter(r => r.path.endsWith('/marks/' + encodeURIComponent(item.id)));
  expect(writes.map(r => r.status)).toEqual([200, 200]);
  expect(writes.map(r => r.body.version)).toEqual([0, 1]);
  expect(writes.map(r => r.result.mark.version)).toEqual([1, 2]);
  expect(writes.map(r => r.result.revision)).toEqual([2, 3]);
  expect(await markInDatabase(real, item.id)).toMatchObject({ status: 'missing', version: 2 });
  await page.reload();
  await expect(page.locator('.status-button').first()).toHaveAttribute('data-status', 'missing');
  const other = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
  try {
    const otherPage = await other.newPage();
    const second = await enter(otherPage, 'rapid@example.test', false);
    expect(second.state.revision).toBe(3);
    expect(second.state.marks.find(mark => mark.item_id === item.id)).toMatchObject({ status: 'missing', version: 2 });
    const secondRow = await openItem(otherPage, second.state, item);
    await expect(secondRow.locator('.status-button')).toHaveAttribute('data-status', 'missing');
  } finally { await other.close(); }
});

test('inline count/spec/note/cost survive status and undo in the real database and after reload', async ({ page, real }) => {
  const session = await enter(page, 'details@example.test');
  const item = session.state.items.find(item => item.qty);
  expect(item).toBeTruthy();
  const row = await openItem(page, session.state, item);
  await row.locator('summary').click();
  for (const [field, value] of [['q', '7'], ['sp', 'Metric real PG specification'], ['n', 'Private real PG note'], ['c', '42.75']]) {
    await row.locator('[data-field="' + field + '"]').fill(value);
    await row.locator('[data-field="' + field + '"]').blur();
    await saved(row);
  }
  const details = { q: 7, sp: 'Metric real PG specification', n: 'Private real PG note', c: 42.75 };
  expect(await markInDatabase(real, item.id)).toMatchObject({ ...details, version: 4 });
  await row.locator('.status-button').click();
  await saved(row);
  expect(await markInDatabase(real, item.id)).toMatchObject({ ...details, status: 'have', version: 5 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(row);
  await expect(row.locator('.status-button')).toHaveAttribute('data-status', 'unknown');
  expect(await markInDatabase(real, item.id)).toMatchObject({ ...details, status: 'unknown', version: 6 });
  await page.reload();
  const reloaded = await openItem(page, session.state, item);
  await reloaded.locator('summary').click();
  for (const [field, value] of Object.entries(details)) await expect(reloaded.locator('[data-field="' + field + '"]')).toHaveValue(String(value));
  expect((await request(page, '/api/workspaces/' + session.workspace.id + '/state')).body.revision).toBe(7);
});

test('same-page account switch clears private UI, real foreign APIs deny access and controlled SW caches no API', async ({ page, real }) => {
  const alpha = await enter(page, 'alpha@example.test');
  const item = alpha.state.items[0];
  const row = await openItem(page, alpha.state, item);
  await row.locator('summary').click();
  await row.locator('[data-field="n"]').fill('ALPHA PRIVATE POSTGRES SENTINEL');
  await row.locator('[data-field="n"]').blur();
  await saved(row);
  await row.locator('.status-button').click();
  await saved(row);
  await noPrivateCache(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await expect(page.getByRole('alert')).toHaveText('You are signed out.');
  await expect(page.locator('.item-row')).toHaveCount(0);
  expect((await request(page, '/api/auth/me')).status).toBe(401);
  // No navigation/reload between logout and registration: stale in-memory state
  // must be cleared by the actual client, not by recreating the JavaScript VM.
  const beta = await enter(page, 'beta@example.test', true, false);
  expect(beta.workspace.id).not.toBe(alpha.workspace.id);
  expect(beta.state.items).toHaveLength(1534);
  expect(beta.state.marks).toHaveLength(0);
  expect(beta.state.items.some(value => value.id === item.id)).toBe(false);
  await expect(page.locator('[aria-label="Audit progress"]')).toHaveText('0/1534');
  const betaRow = await openItem(page, beta.state, beta.state.items[0]);
  await expect(betaRow.locator('.status-button')).toHaveAttribute('data-status', 'unknown');
  await expect(betaRow.locator('[data-field="n"]')).toHaveValue('');
  expect(await page.content()).not.toContain('ALPHA PRIVATE POSTGRES SENTINEL');
  for (const endpoint of ['state', 'checklist']) {
    const denied = await request(page, '/api/workspaces/' + alpha.workspace.id + '/' + endpoint);
    expect(denied.status).toBe(403);
    expect(denied.cache).toBe('no-store');
  }
  const foreignWrite = await request(page, '/api/workspaces/' + alpha.workspace.id + '/marks/' + encodeURIComponent(item.id), 'PUT', { version: 2, status: 'blocking' });
  expect(foreignWrite.status).toBe(403);
  const foreignReference = await request(page, '/api/workspaces/' + beta.workspace.id + '/marks/' + encodeURIComponent(item.id), 'PUT', { version: 0, status: 'have' });
  expect(foreignReference.status).toBe(404);
  const foreignBulk = await request(page, '/api/workspaces/' + alpha.workspace.id + '/marks', 'POST', { marks: [{ itemId: item.id, version: 2, status: 'blocking' }] });
  expect(foreignBulk.status).toBe(403);
  expect(await markInDatabase(real, item.id)).toMatchObject({ n: 'ALPHA PRIVATE POSTGRES SENTINEL', status: 'have', version: 2 });
  await page.reload();
  await expect(page.locator('.item-row').first().locator('[data-field="n"]')).toHaveValue('');
  expect(await page.content()).not.toContain('ALPHA PRIVATE POSTGRES SENTINEL');
  await noPrivateCache(page);
});

test('real bulk endpoint advances one revision, rejects stale/missing preconditions atomically, and reload renders it', async ({ page, real }) => {
  const session = await enter(page, 'bulk@example.test');
  const [one, two] = session.state.items;
  const baseURL = '/api/workspaces/' + session.workspace.id;
  const missing = await request(page, baseURL + '/marks/' + encodeURIComponent(one.id), 'PUT', { status: 'have' });
  expect(missing.status).toBe(428);
  expect(await markInDatabase(real, one.id)).toBeUndefined();
  const batch = { marks: [one, two].map(item => ({ itemId: item.id, version: 0, status: 'have' })) };
  const result = await request(page, baseURL + '/marks', 'POST', batch);
  expect(result.status).toBe(200);
  expect(result.cache).toBe('no-store');
  expect(result.body.revision).toBe(2);
  expect(result.body.marks).toHaveLength(2);
  expect(result.body.marks.map(mark => mark.version)).toEqual([1, 1]);
  for (const item of [one, two]) expect(await markInDatabase(real, item.id)).toMatchObject({ status: 'have', version: 1 });
  const stale = await request(page, baseURL + '/marks', 'POST', { marks: [
    { itemId: one.id, version: 1, status: 'blocking' },
    { itemId: two.id, version: 0, status: 'missing' },
  ] });
  expect(stale.status).toBe(409);
  for (const item of [one, two]) expect(await markInDatabase(real, item.id)).toMatchObject({ status: 'have', version: 1 });
  const after = await request(page, baseURL + '/state');
  expect(after.body.revision).toBe(2);
  await page.reload();
  const row = await openItem(page, after.body, one);
  await expect(row.locator('.status-button')).toHaveAttribute('data-status', 'have');
  await row.locator('.status-button').click();
  await saved(row);
  expect(await markInDatabase(real, one.id)).toMatchObject({ status: 'missing', version: 2 });
  const acknowledgment = real.requests.filter(r => r.path.endsWith('/marks/' + encodeURIComponent(one.id))).at(-1);
  expect(acknowledgment.body.version).toBe(1);
  expect(acknowledgment.result.revision).toBe(3);
});

test('native malformed numeric drafts never clear saved details and explicit zero or clear still work', async ({ page, real }) => {
  const session = await enter(page, 'numbers@example.test');
  const item = session.state.items.find(value => value.qty);
  const row = await openItem(page, session.state, item);
  await row.locator('summary').click();
  for (const [field, value] of [['q', '3'], ['c', '12']]) {
    await row.locator('[data-field="' + field + '"]').fill(value);
    await row.locator('[data-field="' + field + '"]').blur(); await saved(row);
  }
  for (const field of ['q', 'c']) {
    const input = row.locator('[data-field="' + field + '"]');
    const before = await markInDatabase(real, item.id);
    await input.fill(''); await input.pressSequentially('1e');
    expect(await input.evaluate(node => node.validity.badInput)).toBe(true);
    await input.blur();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(row.locator('.item-status')).toContainText('Not saved');
    expect(await markInDatabase(real, item.id)).toEqual(before);
    await input.fill('0'); await input.blur(); await saved(row);
    expect((await markInDatabase(real, item.id))[field]).toBe(0);
    await input.fill(''); await input.blur(); await saved(row);
    expect((await markInDatabase(real, item.id))[field]).toBeNull();
  }
});

test('real seeded auth, overview, checklist and expanded editors have no serious axe findings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await axe(page);
  const session = await enter(page, 'axe@example.test');
  await axe(page);
  const row = await openItem(page, session.state, session.state.items.find(item => item.qty));
  await row.locator('summary').click();
  await axe(page);
});
