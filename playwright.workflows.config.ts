import { defineConfig } from "@playwright/test";
import { REAL_CENTRAL_E2E_ENV } from "./e2e/fixtures/centralAgent";

delete process.env[REAL_CENTRAL_E2E_ENV];

/**
 * The headless workflow-test suite (`bun run test:workflows`): drives a REAL in-process pi agent through
 * the workflow skills — no browser, no webServer, no page fixture. Shares the browser suite's global
 * setup/teardown with Central mode disabled, so it gets a fresh E2E_DATA_DIR, isolated HOME/vendor skill
 * homes, and the deliberately local-auth PI_CODING_AGENT_DIR seed (auth.json + models.json + pinned model).
 * THINKRAIL_E2E_MODEL overrides the pin. Unlike browser `e2e:agent`, it does not stage Central.
 * On-demand only — needs pi auth and spends real provider tokens; never part of `bun run e2e` / CI gates.
 * Design: e2e/workflows/SPEC.md (module-workflow-tests).
 */
export default defineConfig({
	testDir: "./e2e/workflows",
	// Serial: scenarios share process-wide seams (setSessionPublisher, setSessionManagerFactory).
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	// Live scenarios drive a real provider through multi-step flows — well above the browser-suite 30s.
	timeout: 240_000,
	reporter: "list",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
});
