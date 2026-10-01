import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AppConfig, ModelDefault } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_DATA_DIR, E2E_SCREENSHOT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const CONFIG_PATH = join(E2E_DATA_DIR, "config.json");
const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "models-settings", "default-model.png");

type SavedDefaults = Pick<AppConfig, "defaultModel" | "defaultEffort">;

function snapshot(path: string): Buffer | undefined {
	return existsSync(path) ? readFileSync(path) : undefined;
}

function savedDefaults(contents: Buffer | undefined): SavedDefaults {
	if (!contents) return {};
	const config = JSON.parse(contents.toString("utf8")) as Partial<AppConfig>;
	return {
		...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
		...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
	};
}

async function restoreDefaults(defaults: SavedDefaults): Promise<void> {
	const wire = await E2eWire.connect();
	try {
		await wire.request("settings.update", {
			config: {
				defaultModel: defaults.defaultModel ?? null,
				defaultEffort: defaults.defaultEffort ?? null,
			},
		});
	} finally {
		wire.close();
	}
}

test("Models settings save host defaults and apply them to a fresh chat", async ({ page }) => {
	const configSnapshot = snapshot(CONFIG_PATH);
	const defaults = savedDefaults(configSnapshot);

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
		await expect(section).toContainText(
			"If it's unavailable, new chats use the first available model.",
		);

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

		const persisted = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
		expect(persisted.defaultModel).toMatchObject({ provider: "e2e-central", id: modelId });
		expect(persisted.defaultEffort).toBe("high");
		const wire = await E2eWire.connect();
		try {
			expect(await wire.request("model.default", {})).toMatchObject({
				model: { provider: "e2e-central", id: modelId },
				thinkingLevel: "high",
			});
		} finally {
			wire.close();
		}

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
		await restoreDefaults(defaults);
		if (configSnapshot === undefined) rmSync(CONFIG_PATH, { force: true });
		else writeFileSync(CONFIG_PATH, configSnapshot);
	}
});

test("without saved defaults, Settings and a fresh chat use the first available model and clamped medium effort", async ({
	page,
}) => {
	const configSnapshot = snapshot(CONFIG_PATH);
	const defaults = savedDefaults(configSnapshot);

	try {
		await openWorkspaceChat(page);
		const wire = await E2eWire.connect();
		let resolved: ModelDefault;
		try {
			await wire.request("settings.update", {
				config: { defaultModel: null, defaultEffort: null },
			});
			resolved = await wire.request("model.default", {});
		} finally {
			wire.close();
		}
		expect(resolved.model).not.toBeNull();
		const hostConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
		expect(hostConfig).not.toHaveProperty("defaultModel");
		expect(hostConfig).not.toHaveProperty("defaultEffort");

		await openProviders(page);
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		const modelSelector = section.getByTestId("model-selector");
		await expect(modelSelector).toContainText(resolved.model?.name ?? "");
		const effortLevel = resolved.thinkingLevel;
		const effortSelector = section.getByTestId("thinking-selector");
		await expect(effortSelector).toContainText(effortLevel);

		await page.keyboard.press("Escape");
		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		const previousChatCount = await chatTabs.count();
		await page.getByTestId("new-chat").first().click();
		await expect(chatTabs).toHaveCount(previousChatCount + 1);
		await expect(page.getByTestId("model-selector").last()).toContainText(
			resolved.model?.name ?? "",
		);
		await expect(page.getByTestId("thinking-selector").last()).toContainText(effortLevel);
	} finally {
		await restoreDefaults(defaults);
		if (configSnapshot === undefined) rmSync(CONFIG_PATH, { force: true });
		else writeFileSync(CONFIG_PATH, configSnapshot);
	}
});
