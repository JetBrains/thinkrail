import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { E2E_PI_AGENT_DIR, E2E_SCREENSHOT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "environment-settings", "environment.png");

async function clearStoredEnvironment(page: Page): Promise<void> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("environment.update", { environment: { vars: [] } });
	} finally {
		wire.close();
	}
}

async function openEnvironmentSettings(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-environment").click();
	const section = page.getByTestId("settings-environment");
	await expect(section).toBeVisible();
	return section;
}

let agentDir: string;

test.beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-e2e-agent-personal-"));
});

test.afterEach(async ({ page }) => {
	if (!page.isClosed()) await clearStoredEnvironment(page);
	rmSync(agentDir, { recursive: true, force: true });
});

test("Settings → Environment validates, saves and asks for a restart", async ({ page }) => {
	await openFixtureProject(page);
	const section = await openEnvironmentSettings(page);
	await expect(section.getByTestId("settings-environment-agent-dir-effective")).toHaveText(
		E2E_PI_AGENT_DIR,
	);
	await expect(section.getByTestId("settings-environment-restart")).toHaveCount(0);
	await expect(section.getByTestId("settings-environment-save")).toBeDisabled();

	await section.getByTestId("settings-environment-agent-dir").fill(join(agentDir, "missing"));
	await section.getByTestId("settings-environment-add-var").click();
	await section.getByTestId("settings-environment-var-name").fill("THINKRAIL_PORT");
	await section.getByTestId("settings-environment-var-value").fill("1");
	await section.getByTestId("settings-environment-save").click();
	await expect(section.getByTestId("settings-environment-agent-dir-issue")).toBeVisible();
	await expect(section.getByTestId("settings-environment-var-issue")).toBeVisible();
	await expect(section.getByTestId("settings-environment-restart")).toHaveCount(0);

	await section.getByTestId("settings-environment-agent-dir").fill(agentDir);
	await section.getByTestId("settings-environment-var-name").fill("TR_E2E_TOKEN");
	await section.getByTestId("settings-environment-var-value").fill("secret-value");
	await expect(section.getByTestId("settings-environment-var-value")).toHaveAttribute(
		"type",
		"password",
	);
	await section.getByTestId("settings-environment-save").click();

	await expect(section.getByTestId("settings-environment-restart")).toBeVisible();
	await expect(section.getByTestId("settings-environment-agent-dir-overridden")).toBeVisible();
	await expect(section.getByTestId("settings-environment-agent-dir-effective")).toHaveText(
		E2E_PI_AGENT_DIR,
	);
	await expect(section.getByTestId("settings-environment-save")).toBeDisabled();
	mkdirSync(join(E2E_SCREENSHOT_DIR, "environment-settings"), { recursive: true });
	await page.getByTestId("settings-dialog").screenshot({ path: SCREENSHOT_PATH });

	await page.keyboard.press("Escape");
	await page.reload();
	const reopened = await openEnvironmentSettings(page);
	await expect(reopened.getByTestId("settings-environment-agent-dir")).toHaveValue(agentDir);
	await expect(reopened.getByTestId("settings-environment-var-name")).toHaveValue("TR_E2E_TOKEN");
	await expect(reopened.getByTestId("settings-environment-restart")).toBeVisible();
});
