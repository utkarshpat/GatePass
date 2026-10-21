import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['junit', { outputFile: 'output/test-results/browser.xml' }]],
  outputDir: 'output/browser-results',
  use: {
    baseURL: 'http://localhost:18447',
    browserName: 'chromium',
    screenshot: 'off', video: 'off', trace: 'off',
    // No session cookies, screenshots of identities or private photos in artifacts.
    actionTimeout: 20000
  },
  webServer: {
    command: 'node tools/start-dummy-sso.ts',
    url: 'http://localhost:18447/',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test', GATEPASS_SSO_MODE: 'dummy', GATEPASS_DIRECTORY_MODE: 'mock',
      GATEPASS_DUMMY_PORT: '18447',
      GATEPASS_SHARP_PATH: join(process.cwd(), 'node_modules/sharp')
    }
  }
});
