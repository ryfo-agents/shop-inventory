// Isolated real-PostgreSQL browser release gate. Does not alter fixture config.
const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');
module.exports = defineConfig({
  ...base,
  testMatch: '**/postgres.spec.js',
  workers: 1,
  use: { ...base.use, ignoreHTTPSErrors: true, serviceWorkers: 'allow' },
  projects: base.projects.map(project => ({
    ...project,
    use: {
      ...project.use,
      // Chromium's SW fetch does not inherit context ignoreHTTPSErrors.
      // This bypass is limited to this throwaway loopback HTTPS test runner.
      ...(project.use.browserName === 'chromium' ? { launchOptions: { args: ['--ignore-certificate-errors'] } } : {}),
    },
  })),
});
