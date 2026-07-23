// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright config for eval report rendering tests.
 *
 * Usage:
 *   ARTIFACTS_DIR=.artifacts/RHAISTRAT-1433 npx playwright test --config=.claude/skills/eval/tests/playwright.config.js
 */
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'report-rendering.spec.js',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: (process.env.ARTIFACTS_DIR || '.artifacts') + '/report-test-results.json' }],
  ],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 5000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
