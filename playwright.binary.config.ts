import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
	E2E_BINARY_CACHE,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PICK_DIR_POINTER,
} from "./e2e/fixtures/paths";

// The e2e suite run against the COMPILED single-file binary instead of the dev host (`bun run
// e2e:binary`, after `bun run build:binary`). Same tests, same fixtures/global-setup — only the
// webServer differs — so the whole behavioral surface (terminals/PTY, git, editor, embedded-asset
// serving, staging, WS) executes inside the artifact users actually install. This is the broad net for
// the regression class that run-from-source suites can never see (see `registerBundledRuntime` in the
// server agent SPEC — e.g. pi's OAuth flows resolving only from `node_modules`); the *targeted* probes
// for known compiled-binary seams live in `apps/cli/scripts/smoke-binary.ts`.
//
// Excluded here: `@agent` (needs provider auth — never in CI) and `@dev-seam` (the fake login
// providers are registered by `packages/server/src/dev.ts`, which deliberately never ships — the
// artifact's login path is covered by smoke-binary's real-provider probe instead).
//
// Not concurrent-safe with `bun run e2e` (both own E2E_DATA_DIR); run them sequentially. Unix-only for
// now, like the main config's PATH stub wiring (`:` separator, `#!/bin/sh` central stub).

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const binary =
	process.env.THINKRAIL_E2E_BINARY ??
	fileURLToPath(new URL("./apps/cli/dist/thinkrail", import.meta.url));
if (!existsSync(binary)) {
	throw new Error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
}
const PORT = 24272; // dev 24242 · e2e 24252 · smoke 24262 · e2e:binary 24272 — never collide
const fakeBinDir = fileURLToPath(new URL("./e2e/fixtures/bin", import.meta.url));

export default defineConfig({
	testDir: "./e2e",
	testIgnore: "workflows/**",
	grepInvert: /@agent|@dev-seam/,
	// Serial: the suite shares one stateful host (one DATA_DIR), so tests must not race on persistence.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never", outputFolder: "playwright-report-binary" }]]
		: "list",
	outputDir: "test-results-binary",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// The artifact under test IS the server: no THINKRAIL_STATIC_DIR (the embedded web assets are part
	// of what's verified) and an isolated cache root so the binary's staging path runs against a dir the
	// teardown wiped last run. Every other seam is the same as the dev-host config — all of them are
	// honored by production code (`THINKRAIL_PICK_DIR`, `THINKRAIL_GH_OFFLINE`) or ride PATH/env
	// (stub `central`, `PI_OFFLINE`), which is what makes the suite boot-agnostic.
	webServer: {
		command: `"${binary}" --no-open`,
		cwd: rootDir,
		url: `http://localhost:${PORT}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			THINKRAIL_PORT: String(PORT),
			THINKRAIL_DATA_DIR: E2E_DATA_DIR,
			XDG_CACHE_HOME: E2E_BINARY_CACHE,
			THINKRAIL_PICK_DIR: E2E_PICK_DIR_POINTER,
			THINKRAIL_GH_OFFLINE: "1",
			// Keep cross-agent personal skill aliases away from the developer's real homes/overrides.
			HOME: E2E_HOME_DIR,
			CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
			CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
			GEMINI_CLI_HOME: E2E_HOME_DIR,
			PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
			PI_OFFLINE: "1",
			PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
			WIRE_PROXY_PORT: "19516",
			CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
		},
	},
});
