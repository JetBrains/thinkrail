import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_DIR, E2E_PI_AGENT_DIR, E2E_PICK_DIR_POINTER } from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
const PORT = 24252; // dedicated e2e port — never collides with dev:server (24242)
// A stub `central` (JetBrains Central CLI) on the host's PATH so the JetBrains AI flow is drivable
// deterministically — no real CLI, network, or JetBrains auth. Prepended so it wins over any real install.
const fakeBinDir = fileURLToPath(new URL("./e2e/fixtures/bin", import.meta.url));

export default defineConfig({
	testDir: "./e2e",
	// Serial: the suite shares one stateful host (one DATA_DIR), so tests must not race on persistence.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
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
			THINKRAIL_PORT: String(PORT),
			THINKRAIL_STATIC_DIR: staticDir,
			THINKRAIL_DATA_DIR: E2E_DATA_DIR,
			// Stub the host's native directory picker so "Open project" is drivable headlessly. It names a
			// control *file* (seeded to the git fixture in globalSetup); a test can rewrite it to hand the
			// picker a different folder (e.g. a non-git one) without restarting the shared host.
			THINKRAIL_PICK_DIR: E2E_PICK_DIR_POINTER,
			// Force the New-Workspace dialog's `gh` probe to "Not connected" so the suite is deterministic
			// regardless of the dev machine's real `gh` auth — and exercises the offline/local-branch degrade path.
			THINKRAIL_GH_OFFLINE: "1",
			// Point pi at an ISOLATED agent dir (seeded with a copy of the user's auth in globalSetup), so the
			// @agent suite uses a real provider yet `setModel`/`setThinkingLevel` persist here — never the
			// user's real `~/.pi/agent`. (Provider env vars in the inherited env still resolve auth too.)
			PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
			// Put the stub `central` first on PATH (see fakeBinDir), and pin the proxy port so wiring is
			// deterministic and never reads the dev machine's real ~/.wire/config.json.
			PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
			WIRE_PROXY_PORT: "19516",
		},
	},
});
