import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { THINKING_LEVELS } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_PI_AGENT_DIR, E2E_SCREENSHOT_DIR } from "./fixtures/paths";

const SETTINGS_PATH = join(E2E_PI_AGENT_DIR, "settings.json");
const SETTINGS_BACKUP_PATH = `${SETTINGS_PATH}.bak`;
const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "models-settings", "default-model.png");

function snapshot(path: string): Buffer | undefined {
	return existsSync(path) ? readFileSync(path) : undefined;
}

function restore(path: string, contents: Buffer | undefined): void {
	if (contents === undefined) rmSync(path, { force: true });
	else writeFileSync(path, contents);
}

test("Models settings save Pi's global defaults and apply them to a fresh chat", async ({
	page,
}) => {
	const settingsSnapshot = snapshot(SETTINGS_PATH);
	const backupSnapshot = snapshot(SETTINGS_BACKUP_PATH);

	try {
		await openWorkspaceChat(page);
		await openProviders(page);
		await waitForCentralState(page, "supported");
		await connectCentral(page);
		await waitForCentralState(page, "configured");
		const dialog = page.getByTestId("settings-dialog");
		await expect(dialog).toBeVisible();
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		await expect(section).toContainText("Default model");
		await expect(section).toContainText("A project's .pi/settings.json can override it.");

		const modelSelector = section.getByTestId("model-selector");
		await expect(modelSelector).toBeVisible();
		await modelSelector.click();
		const modelOption = page.locator(
			'[data-testid="model-option"][data-model-id="e2e-central-model"]',
		);
		await expect(modelOption).toBeVisible();
		const modelId = await modelOption.getAttribute("data-model-id");
		const modelName = (
			await modelOption.locator("span.flex.min-w-0 > span").first().textContent()
		)?.trim();
		if (!modelId || !modelName)
			throw new Error("The model catalog returned an incomplete model option");
		await modelOption.click();
		await expect(modelSelector).toContainText(modelName);

		const effortSelector = section.getByTestId("thinking-selector");
		await expect(effortSelector).toBeEnabled();
		await effortSelector.click();
		const effortOption = page.locator('[data-testid="thinking-option"][data-level="high"]');
		await expect(effortOption).toBeVisible();
		await effortOption.click();
		await expect(effortSelector).toContainText("high");

		const savedSettings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<
			string,
			unknown
		>;
		expect(savedSettings.defaultProvider).toBe("e2e-central");
		expect(savedSettings.defaultModel).toBe(modelId);
		expect(savedSettings.defaultThinkingLevel).toBe("high");

		mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
		await section.screenshot({ path: SCREENSHOT_PATH, animations: "disabled" });

		await page.keyboard.press("Escape");
		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		const previousChatCount = await chatTabs.count();
		await page.getByTestId("new-chat").first().click();
		await expect(chatTabs).toHaveCount(previousChatCount + 1);
		const freshChatModel = page.getByTestId("model-selector").last();
		await expect(freshChatModel).toBeVisible();
		await expect(freshChatModel).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText("high");

		await openProviders(page);
		await page.getByTestId("jetbrains-disconnect").click();
		await waitForCentralState(page, "supported");
	} finally {
		restore(SETTINGS_PATH, settingsSnapshot);
		restore(SETTINGS_BACKUP_PATH, backupSnapshot);
	}
});

test("Models settings offers every Pi effort level when no default model is saved", async ({
	page,
}) => {
	const settingsSnapshot = snapshot(SETTINGS_PATH);
	const backupSnapshot = snapshot(SETTINGS_BACKUP_PATH);

	try {
		await openWorkspaceChat(page);
		const settings = (
			settingsSnapshot ? JSON.parse(settingsSnapshot.toString("utf8")) : {}
		) as Record<string, unknown>;
		delete settings.defaultProvider;
		delete settings.defaultModel;
		writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
		expect(settings.defaultProvider).toBeUndefined();
		expect(settings.defaultModel).toBeUndefined();

		await openProviders(page);
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		const modelSelector = section.getByTestId("model-selector");
		await expect(modelSelector).toContainText("Pi chooses automatically");

		const effortSelector = section.getByTestId("thinking-selector");
		await expect(effortSelector).toBeEnabled();
		await effortSelector.click();
		await expect(page.getByTestId("thinking-option")).toHaveCount(THINKING_LEVELS.length);
		for (const level of THINKING_LEVELS) {
			await expect(
				page.locator(`[data-testid="thinking-option"][data-level="${level}"]`),
			).toBeVisible();
		}
	} finally {
		restore(SETTINGS_PATH, settingsSnapshot);
		restore(SETTINGS_BACKUP_PATH, backupSnapshot);
	}
});
