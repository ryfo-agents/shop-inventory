const { test: base, expect } = require('@playwright/test');
const { startFixture } = require('./fixture-server');
// Each journey gets a fresh server/database analogue and a fresh browser context.
const test = base.extend({ baseURL: async ({}, use) => {
  const fixture = await startFixture();
  try { await use(fixture.url); } finally { await fixture.close(); }
} });
const AxeBuilder = require('@axe-core/playwright').default;

async function signIn(page, account = 'alpha') {
  await page.getByLabel('Email', { exact: true }).fill(account + '@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Know what is in the shop.' })).toBeVisible();
}
async function section(page) {
  await page.locator('a.section-card').first().click();
  await expect(page.locator('.status-button').first()).toBeVisible();
}
async function axe(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('root deployed client: sign-in, audit and reload persistence', async ({ page }) => {
  await signIn(page);
  await section(page);
  const button = page.locator('.status-button').first();
  const before = await button.getAttribute('data-status');
  await button.click();
  await expect(button).not.toHaveAttribute('data-status', before);
  await expect(page.locator('.item-status').first()).toHaveText('Saved');
  const saved = await button.getAttribute('data-status');
  await page.reload();
  await expect(page.locator('.status-button').first()).toHaveAttribute('data-status', saved);
});

test('same browser account switch cannot show previous account private inventory', async ({ page }) => {
  await signIn(page);
  await section(page);
  await expect(page.getByText('Alpha wrench', { exact: true })).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await signIn(page, 'beta');
  await section(page);
  await expect(page.getByText('Beta wrench', { exact: true })).toBeVisible();
  await expect(page.getByText('Alpha wrench', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Beta wrench', { exact: true })).toBeVisible();
  const privateCacheKeys = await page.evaluate(async () => {
    const keys = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (new URL(request.url).pathname.startsWith('/api/')) keys.push(new URL(request.url).pathname);
    return keys;
  });
  expect(privateCacheKeys).toEqual([]);
});

test('auth, overview and checklist have no serious automated accessibility findings', async ({ page }) => {
  await axe(page); await signIn(page); await axe(page); await section(page); await axe(page);
});

test.describe('network faults (SW blocked so interception is deterministic)', () => {
  test.use({ serviceWorkers: 'block' });
test('delayed rapid taps keep latest intent after acknowledgement and reload', async ({ page }) => {
  await signIn(page); await section(page);
  let first = true;
  await page.route('**/api/workspaces/*/marks/*', async route => {
    if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 700)); }
    await route.continue();
  });
  const button = page.locator('.status-button').first();
  const cycle = ['unknown','have','missing','upgrade','blocking','na'];
  const start = await button.getAttribute('data-status');
  const intended = cycle[(cycle.indexOf(start) + 2) % cycle.length];
  await button.click(); await button.click();
  await expect(button).toHaveAttribute('data-status', intended);
  await page.waitForTimeout(1100);
  await expect(button).toHaveAttribute('data-status', intended);
  await expect(page.locator('.item-status').first()).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('.status-button').first()).toHaveAttribute('data-status', intended);
});

test('failed write is announced without claiming saved and recovery works', async ({ page }) => {
  await signIn(page); await section(page);
  const button = page.locator('.status-button').first();
  const before = await button.getAttribute('data-status');
  await page.route('**/api/workspaces/*/marks/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture_unavailable"}' }));
  await button.click();
  await expect(page.locator('#live')).toContainText(/could not save|not saved|failed/i);
  await expect(page.locator('.item-status').first()).not.toHaveText('Saving…');
  await page.unroute('**/api/workspaces/*/marks/*');
  // Reload is a conservative recovery path; no assumed retry-control contract.
  await page.reload();
  await expect(page.locator('.status-button').first()).toHaveAttribute('data-status', before);
  await page.locator('.status-button').first().click();
  await expect(page.locator('.item-status').first()).toHaveText('Saved');
});

test('offline write fails visibly and session expiry returns to sign-in', async ({ page, context }) => {
  await signIn(page); await section(page);
  await context.setOffline(true);
  await page.locator('.status-button').first().click();
  await expect(page.locator('#live')).toContainText(/could not save|not saved|offline|failed/i);
  await context.setOffline(false);
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Alpha wrench', { exact: true })).toHaveCount(0);
});
});
