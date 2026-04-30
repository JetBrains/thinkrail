import { defineConfig, devices } from "@playwright/test";

const FRONTEND_URL = process.env.BONSAI_FRONTEND_URL ?? "http://localhost:3000";
const BACKEND_URL = process.env.BONSAI_BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./globalSetup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: { "X-Bonsai-E2E": "1" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  metadata: { backendUrl: BACKEND_URL },
});
