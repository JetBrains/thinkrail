import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { E2E_DATA_DIR } from "./fixtures/paths";

// The first-run hard gate. The shared suite host always has models (real auth on a dev machine, the
// stub provider on CI), so the gate never shows there — these specs boot a SECOND host with an empty
// pi agent dir and a provider-env-scrubbed environment (env keys would otherwise unlock models), and
// walk the gate: tiles → API-key panel → save a key → success beat → Start building → the shell.
// A pasted key counts as configured auth without any network call, so this runs no-agent.

const GATE_PORT = 24253;
const GATE_URL = `http://localhost:${GATE_PORT}`;
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const staticDir = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
const gateDataDir = `${E2E_DATA_DIR}-gate`;

let host: ChildProcess | null = null;

/** Only what the host needs — provider env keys (ANTHROPIC_API_KEY, …) must not leak in. */
function scrubbedEnv(): NodeJS.ProcessEnv {
	const keep = ["PATH", "HOME", "TMPDIR", "SHELL", "USER", "LOGNAME", "LANG", "TERM"];
	const env: NodeJS.ProcessEnv = {};
	for (const key of keep) if (process.env[key]) env[key] = process.env[key];
	return {
		...env,
		THINKRAIL_PORT: String(GATE_PORT),
		THINKRAIL_STATIC_DIR: staticDir,
		THINKRAIL_DATA_DIR: `${gateDataDir}/state`,
		PI_CODING_AGENT_DIR: `${gateDataDir}/pi-agent`, // empty → zero providers → zero models
		THINKRAIL_NO_BROWSER: "1",
		THINKRAIL_GH_OFFLINE: "1",
	};
}

test.beforeAll(async () => {
	rmSync(gateDataDir, { recursive: true, force: true });
	mkdirSync(`${gateDataDir}/pi-agent`, { recursive: true });
	host = spawn("bun", ["packages/server/src/dev.ts"], {
		cwd: rootDir,
		env: scrubbedEnv(),
		stdio: "ignore",
	});
	// Wait for /health (the web app is already built by the main webServer step).
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const res = await fetch(`${GATE_URL}/health`);
			if (res.ok) break;
		} catch {
			/* not up yet */
		}
		if (Date.now() > deadline) throw new Error("gate host did not come up");
		await new Promise((r) => setTimeout(r, 250));
	}
});

test.afterAll(() => {
	host?.kill("SIGTERM");
	host = null;
	rmSync(gateDataDir, { recursive: true, force: true });
});

test("zero models → the gate IS the app: hero + OAuth trio + API-key path, no shell behind it", async ({
	page,
}) => {
	await page.goto(GATE_URL);
	const gate = page.getByTestId("auth-gate");
	await expect(gate).toBeVisible();

	// The definitive-zero pill + every entry path.
	await expect(page.getByTestId("auth-gate-pill")).toContainText("0 models");
	await expect(page.getByTestId("auth-tile-jetbrains")).toBeVisible();
	await expect(page.getByTestId("auth-tile-anthropic")).toBeVisible();
	await expect(page.getByTestId("auth-tile-openai-codex")).toBeVisible();
	await expect(page.getByTestId("auth-tile-github-copilot")).toBeVisible();
	await expect(page.getByTestId("auth-apikey-toggle")).toBeVisible();

	// The JetBrains hero reflects the probe (this throwaway machine state: not installed OR detected —
	// either way the state line renders).
	await expect(page.getByTestId("auth-jb-state")).toBeVisible();
});

test("JetBrains wizard opens consent-first: the exact install command before anything runs", async ({
	page,
}) => {
	await page.goto(GATE_URL);
	await page.getByTestId("auth-tile-jetbrains").click();
	const wizard = page.getByTestId("auth-jb-wizard");
	await expect(wizard).toBeVisible();
	// Consent screen only when jbcentral isn't installed; a dev machine with it installed starts at
	// Sign in. Either way, nothing runs without a click.
	const consent = page.getByTestId("auth-jb-consent");
	if (await consent.isVisible()) {
		await expect(page.getByTestId("auth-jb-install-cmd")).toContainText("install.sh | bash");
		await expect(page.getByTestId("auth-jb-install")).toBeVisible();
	} else {
		await expect(page.getByTestId("auth-jb-signin")).toBeVisible();
	}
	await page.getByTestId("auth-jb-cancel").click();
	await expect(page.getByTestId("auth-tile-jetbrains")).toBeVisible();
});

test("saving an API key closes the gate: success beat → Start building → the shell", async ({
	page,
}) => {
	await page.goto(GATE_URL);
	await page.getByTestId("auth-apikey-toggle").click();
	await expect(page.getByTestId("auth-apikey-panel")).toBeVisible();

	// Pick anthropic (top of the catalog) and paste a key — configured auth needs no network.
	await page.getByTestId("auth-provider-anthropic").click();
	await page.getByTestId("auth-apikey-input").fill("sk-ant-e2e-fake-key");
	await page.getByTestId("auth-apikey-save").click();

	// modelCount flips > 0 → the success beat holds the gate with the CTA.
	const success = page.getByTestId("auth-gate-success");
	await expect(success).toBeVisible();
	await expect(page.getByTestId("auth-gate-pill")).not.toContainText("0 models");

	await page.getByTestId("auth-gate-enter").click();
	await expect(page.getByTestId("auth-gate")).toBeHidden();
	await expect(page.getByTestId("shell")).toBeVisible();

	// The durable surface agrees: Settings → Providers shows anthropic configured.
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	await expect(page.getByTestId("settings-provider-status-anthropic")).toHaveAttribute(
		"data-connected",
		"true",
	);
});

test("the main suite host (with models) never shows the gate", async ({ page, baseURL }) => {
	await page.goto(baseURL ?? "/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("auth-gate")).toBeHidden();
});
