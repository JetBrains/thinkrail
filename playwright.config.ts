import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_EDITOR_LOG,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PICK_DIR_POINTER,
	E2E_PORT,
	E2E_WIRE_PROXY_PORT,
} from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
// Per-worktree derived port (e2e/fixtures/paths.ts) — parallel worktrees (this product's own working
// model) run their suites concurrently without fighting over one port, zero config; the dev host
// (24242) stays clear. Slot clashes are auto-arbitrated by an atomic claim registry
// (e2e/fixtures/portBlock.ts). Supersedes the manual THINKRAIL_E2E_PORT knob
// (THINKRAIL_E2E_PORT_BASE pins the whole per-worktree block explicitly when ever needed).
const PORT = E2E_PORT;
const isShardLane = process.env.THINKRAIL_E2E_LANE !== undefined;
const hostCommand =
	process.env.THINKRAIL_E2E_SKIP_BUILD === "1"
		? "bun packages/server/src/dev.ts"
		: "bun run build:web && bun packages/server/src/dev.ts";
// A stub `central` (JetBrains Central CLI) and `code` (VS Code CLI) on the host's PATH so the JetBrains AI
// flow and the workspace row's "Open in" are both drivable deterministically — no real CLI, network,
// JetBrains auth, or editor install. Prepended so each wins over any real install on the dev machine.
const fakeBinDir = fileURLToPath(new URL("./e2e/fixtures/bin", import.meta.url));

export default defineConfig({
	testDir: "./e2e",
	// The headless workflow-test suite has its own config (playwright.workflows.config.ts) — no browser,
	// no webServer; `bun run test:workflows`. Never picked up by the browser suites.
	testIgnore: "workflows/**",
	// One worker owns one stateful host. Shard lanes stay serial internally; fullyParallel only lets
	// Playwright distribute individual tests (rather than uneven whole files) across separate processes.
	fullyParallel: isShardLane,
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
		command: hostCommand,
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
			// Keep cross-agent personal skill aliases away from the developer's real homes/overrides.
			HOME: E2E_HOME_DIR,
			CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
			CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
			GEMINI_CLI_HOME: E2E_HOME_DIR,
			// Point pi at an ISOLATED agent dir (seeded with a copy of the user's auth in globalSetup), so the
			// @agent suite uses a real provider yet `setModel`/`setThinkingLevel` persist here — never the
			// user's real `~/.pi/agent`. (Provider env vars in the inherited env still resolve auth too.)
			PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
			// Keep the suite hermetic: `model.list` fires a detached pi.dev catalog refresh (issue #98) that
			// must never leave the machine in tests — PI_OFFLINE is pi's own convention and our guard honors it.
			PI_OFFLINE: "1",
			// Put the stub `central` first on PATH (see fakeBinDir), and pin the proxy port so wiring is
			// deterministic and never reads the dev machine's real ~/.wire/config.json.
			PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
			WIRE_PROXY_PORT: String(E2E_WIRE_PROXY_PORT),
			// Control file the stub `central` reads live to pick its outcome (signed in / not signed in /
			// error), letting a test drive the JetBrains AI card's non-happy branches without restarting the host.
			CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
			// Where the stub `code` appends each invocation's argv, so a test can assert "Open in VS Code"
			// actually launched with the right worktree path.
			THINKRAIL_E2E_EDITOR_LOG: E2E_EDITOR_LOG,
			// Register a deterministic fake OAuth provider (`e2e-oauth`) so the in-app login flow is drivable
			// end-to-end without a real provider/browser (see packages/server/src/dev.ts).
			THINKRAIL_E2E_FAKE_OAUTH: "1",
			// Analytics: every channel sends now, and `CI` is unset on a developer machine — so the suite
			// mutes explicitly. Nothing an e2e run does may reach PostHog.
			THINKRAIL_NO_ANALYTICS: "1",
		},
	},
});
