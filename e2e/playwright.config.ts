import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Self-contained e2e configuration. `npm test` (in `e2e/`) starts the full
 * Bonsai stack via `./run.sh` from the repo root on free ports and points
 * the spec runner at it. No separate `./run.sh` shell is needed.
 *
 * The Electron e2e suite (`electron/playwright.config.ts`) spawns its own
 * backend; this config only governs the web suite.
 */

function findTwoFreePorts(): [number, number] {
  // Sync port probe — `defineConfig` doesn't support an async export, so
  // we shell out to a one-liner node child. Picks two ports while both
  // listening sockets are still open, so the kernel can't recycle the
  // first port for the second probe — i.e. the two ports are guaranteed
  // distinct. Both sockets close before the child exits; consumers (the
  // backend and Vite) bind the ports immediately afterwards.
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      "const net = require('net');" +
        "const a = net.createServer(); const b = net.createServer();" +
        "a.listen(0, () => b.listen(0, () => {" +
        "  process.stdout.write(a.address().port + ',' + b.address().port);" +
        "  a.close(); b.close();" +
        "}));",
    ],
    { encoding: "utf8" },
  );
  const [a, b] = out.trim().split(",").map((s) => parseInt(s, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) {
    throw new Error(`findTwoFreePorts: bad probe output: ${JSON.stringify(out)}`);
  }
  return [a, b];
}

function getOrPickPorts(): [number, number] {
  // Playwright loads `playwright.config.ts` multiple times: once in the
  // main process (for `webServer` + global metadata) and once in each
  // worker process (for `use` + project settings). The main process picks
  // the ports and stashes them in an env var; workers inherit env from
  // the main process and reuse the same values, so the webServer Bonsai
  // is on the same ports the workers point their `baseURL` at.
  const cached = process.env.__BONSAI_E2E_PORTS;
  if (cached) {
    const [a, b] = cached.split(",").map((s) => parseInt(s, 10));
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && a !== b) {
      return [a, b];
    }
  }
  const [a, b] = findTwoFreePorts();
  process.env.__BONSAI_E2E_PORTS = `${a},${b}`;
  return [a, b];
}

const [BACKEND_PORT, FRONTEND_PORT] = getOrPickPorts();
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// Helpers / globalSetup / specs read these from `process.env`. We set them
// here at config load time so the single worker (workers=1) and the spawned
// webServer all see the same values.
process.env.BONSAI_FRONTEND_URL = FRONTEND_URL;
process.env.BONSAI_BACKEND_URL = BACKEND_URL;

const REPO_ROOT = path.resolve(__dirname, "..");

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
  metadata: { backendUrl: BACKEND_URL, frontendUrl: FRONTEND_URL },
  webServer: {
    command: "./run.sh",
    cwd: REPO_ROOT,
    // Probe the frontend — Vite proxies /ws and /api to the backend, so
    // a 200 here implies the WS proxy hop works. globalSetup probes the
    // backend directly afterwards as a belt-and-braces check.
    url: FRONTEND_URL,
    // First-run install (`uv sync`, `npm install`) can dominate.
    timeout: 5 * 60_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      BACKEND_PORT: String(BACKEND_PORT),
      FRONTEND_PORT: String(FRONTEND_PORT),
    },
  },
});
