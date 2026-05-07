import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./globalSetup.ts",
  // Electron startup includes spawning the PyInstaller backend and TCP-polling
  // it ready (≤30 s). Keep test timeout generous to absorb cold-start variance.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report-electron" }]],
  outputDir: "../test-results-electron",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // No `projects` block — Playwright's `_electron` API is driven from each spec
  // via the `electronApp` fixture; there is no chromium/firefox/webkit project.
});
