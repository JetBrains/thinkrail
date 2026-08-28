import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { devices, type PlaywrightTestConfig } from "@playwright/test";
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
} from "./fixtures/paths";

export function artifactHostEnvironment(cacheDir: string): Record<string, string> {
	const hostPath = [E2E_FAKE_BIN_DIR, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
	if (hostPath.split(delimiter).some((directory) => existsSync(join(directory, "pi")))) {
		throw new Error("artifact e2e host PATH must not contain pi");
	}
	return {
		THINKRAIL_DATA_DIR: E2E_DATA_DIR,
		XDG_CACHE_HOME: cacheDir,
		THINKRAIL_PICK_DIR: E2E_PICK_DIR_POINTER,
		THINKRAIL_GH_OFFLINE: "1",
		HOME: E2E_HOME_DIR,
		USERPROFILE: E2E_HOME_DIR,
		CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
		CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
		GEMINI_CLI_HOME: E2E_HOME_DIR,
		PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
		PI_OFFLINE: "1",
		PATH: hostPath,
		CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
		CENTRAL_STUB_LOG: E2E_CENTRAL_LOG,
		CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
		CENTRAL_STUB_BAD_EXTENSION_SOURCE: E2E_CENTRAL_BAD_EXTENSION_SOURCE,
		THINKRAIL_E2E_EDITOR_LOG: E2E_EDITOR_LOG,
		THINKRAIL_NO_ANALYTICS: "1",
	};
}

export function artifactPlaywrightConfig(
	name: "binary" | "desktop",
	baseURL: string,
	managedFixtures: boolean,
): PlaywrightTestConfig {
	return {
		testDir: "./e2e",
		testIgnore: "workflows/**",
		grepInvert: /@agent|@dev-seam/,
		fullyParallel: false,
		workers: 1,
		forbidOnly: !!process.env.CI,
		retries: process.env.CI ? 1 : 0,
		timeout: 30_000,
		reporter: process.env.CI
			? [["github"], ["html", { open: "never", outputFolder: `playwright-report-${name}` }]]
			: "list",
		outputDir: `test-results-${name}`,
		...(managedFixtures
			? {
					globalSetup: "./e2e/global-setup.ts",
					globalTeardown: "./e2e/global-teardown.ts",
				}
			: {}),
		use: {
			baseURL,
			trace: "on-first-retry",
		},
		projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	};
}
