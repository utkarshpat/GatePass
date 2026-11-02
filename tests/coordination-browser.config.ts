import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  testMatch: "coordination-page.spec.ts",
  timeout: 120000,
  expect: { timeout: 25000 },
  workers: 1,
  retries: 0,
  outputDir: "../output/coordination-browser",
  reporter: [
    ["list"],
    ["junit", { outputFile: "output/test-results/coordination-browser.xml" }],
  ],
  use: {
    actionTimeout: 20000,
    timezoneId: "Asia/Kolkata",
    baseURL: "http://localhost:18463",
    browserName: "chromium",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    cwd: process.cwd(),
    command: "node tools/test-coordination-server.ts",
    url: "http://localhost:18463/",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: "test",
      GATEPASS_SSO_MODE: "dummy",
      GATEPASS_DIRECTORY_MODE: "mock",
    },
  },
});
