import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { assertCentralPlaywrightRunner } from "./e2e/agentRunPlan";
import {
	CENTRAL_STUB_READ_ONLY_ENV,
	isRealCentralE2e,
	REAL_CENTRAL_E2E_ENV,
} from "./e2e/fixtures/centralAgent";
import { hermeticE2ePath, resolveBunExecutable } from "./e2e/fixtures/executables";
import {
	E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_EDITOR_LOG,
	E2E_FAKE_BIN_DIR,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PICK_DIR_POINTER,
	E2E_PORT,
} from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
// Per-worktree derived port (e2e/fixtures/paths.ts) — parallel worktrees (this product's own working
// model) run their suites concurrently without fighting over one port, zero config; the dev host
// (24242) stays clear. Slot clashes are auto-arbitrated by an atomic claim registry
// (e2e/fixtures/portBlock.ts). Supersedes the manual THINKRAIL_E2E_PORT knob
// (THINKRAIL_E2E_PORT_BASE pins the whole per-worktree block explicitly when ever needed).
const PORT = E2E_PORT;
const centralMode = isRealCentralE2e();
assertCentralPlaywrightRunner(process.env, process.argv);
const bunExecutable = resolveBunExecutable();
const hostPath = hermeticE2ePath(E2E_FAKE_BIN_DIR);
if (hostPath.split(delimiter).some((directory) => existsSync(join(directory, "pi"))))
	throw new Error("e2e host PATH must not contain pi");
const isShardLane = process.env.THINKRAIL_E2E_LANE !== undefined;
const hostCommand =
	process.env.THINKRAIL_E2E_SKIP_BUILD === "1"
		? `${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`
		: `${JSON.stringify(bunExecutable)} run build:web && ${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`;
export default defineConfig({
	testDir: "./e2e",
	// The headless workflow-test suite has its own config (playwright.workflows.config.ts) — no browser,
	// no webServer; `bun run test:workflows`. Never picked up by the browser suites.
	testIgnore: "workflows/**",
	...(centralMode ? { grep: /@agent/ } : { grepInvert: /@agent/ }),
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
			USERPROFILE: E2E_HOME_DIR,
			CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
			CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
			GEMINI_CLI_HOME: E2E_HOME_DIR,
			PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
			// Keep the suite hermetic: `model.list` fires a detached pi.dev catalog refresh (issue #98) that
			// must never leave the machine in tests — PI_OFFLINE is pi's own convention and our guard honors it.
			PI_OFFLINE: "1",
			// Lane-local `central` + `code` stubs: deterministic and safe under process-level sharding.
			PATH: hostPath,
			CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
			CENTRAL_STUB_LOG: E2E_CENTRAL_LOG,
			CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
			CENTRAL_STUB_BAD_EXTENSION_SOURCE: E2E_CENTRAL_BAD_EXTENSION_SOURCE,
			...(centralMode
				? {
						[REAL_CENTRAL_E2E_ENV]: "1",
						[CENTRAL_STUB_READ_ONLY_ENV]: "1",
					}
				: {}),
			// Where the stub `code` appends each invocation's argv, so a test can assert "Open in VS Code"
			// actually launched with the right worktree path.
			THINKRAIL_E2E_EDITOR_LOG: E2E_EDITOR_LOG,
			// Register a deterministic fake OAuth provider (`e2e-oauth`) so the in-app login flow is drivable
			// end-to-end without a real provider/browser (see packages/server/src/dev.ts).
			THINKRAIL_E2E_FAKE_OAUTH: centralMode ? "0" : "1",
			// Analytics: every channel sends now, and `CI` is unset on a developer machine — so the suite
			// mutes explicitly. Nothing an e2e run does may reach PostHog.
			THINKRAIL_NO_ANALYTICS: "1",
		},
	},
});
