import type { FullConfig } from "@playwright/test";

/**
 * Liveness probe — assert the backend is reachable before any spec runs.
 *
 * `playwright.config.ts` spawns the full Bonsai stack via `./run.sh` as a
 * `webServer`. Playwright waits on the frontend URL to return 200 before
 * calling globalSetup. The frontend can come up a beat before the backend,
 * so we poll `/api/server-info` here rather than expect a single fetch to
 * succeed.
 */

const BACKEND_URL = process.env.BONSAI_BACKEND_URL ?? "http://localhost:8000";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const url = `${BACKEND_URL.replace(/\/$/, "")}/api/server-info`;
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `e2e globalSetup: backend at ${url} never became ready after 60s. ` +
      `Inspect Playwright's webServer stdout/stderr above for the failure.\n` +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
