import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
const PORT = 24252; // dedicated e2e port — never collides with dev:server (24242)

export default defineConfig({
	testDir: "./e2e",
	// Serial: the suite shares one stateful host (one DATA_DIR), so tests must not race on persistence.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	reporter: process.env.CI ? "github" : "list",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// Self-contained: build the web app, boot the host on an isolated port + state dir, and tear it all
	// down after. `bun run e2e` needs nothing else running.
	webServer: {
		command: "bun run build:web && bun packages/server/src/dev.ts",
		cwd: rootDir,
		url: `http://localhost:${PORT}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			THINKRAIL_PI_PORT: String(PORT),
			THINKRAIL_PI_STATIC_DIR: staticDir,
			THINKRAIL_PI_DATA_DIR: E2E_DATA_DIR,
			// Stub the host's native directory picker so "Open project" is drivable headlessly.
			THINKRAIL_PI_PICK_DIR: E2E_FIXTURE_REPO,
			// The host inherits the parent env (Playwright merges `process.env`), so the @agent suite uses
			// pi's default auth (provider env vars + `~/.pi/agent/auth.json`) with no key special-casing.
		},
	},
});
