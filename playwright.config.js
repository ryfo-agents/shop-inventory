const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.js', fullyParallel: false,
  workers: 1, retries: 0, timeout: 30000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
