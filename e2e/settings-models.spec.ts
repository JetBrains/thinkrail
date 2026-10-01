import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { AppConfig, ModelDefault } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_SCREENSHOT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "models-settings", "default-model.png");

type SavedDefaults = Pick<AppConfig, "defaultModel" | "defaultEffort">;

async function withHostWire<T>(page: Page, run: (wire: E2eWire) => Promise<T>): Promise<T> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

async function readDefaults(page: Page): Promise<SavedDefaults> {
	const config = await withHostWire(page, (wire) =>
		wire.request("settings.update", { config: {} }),
	);
	return {
		...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
		...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
	};
}

async function restoreDefaults(page: Page, defaults: SavedDefaults): Promise<void> {
	await withHostWire(page, (wire) =>
		wire.request("settings.update", {
			config: {
				defaultModel: defaults.defaultModel ?? null,
				defaultEffort: defaults.defaultEffort ?? null,
			},
		}),
	);
}

async function connectFixtureProvider(page: Page): Promise<void> {
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
}

async function disconnectFixtureProvider(page: Page): Promise<void> {
	await openProviders(page);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
}

async function openFreshChat(page: Page): Promise<void> {
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const previousChatCount = await chatTabs.count();
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(previousChatCount + 1);
}

test("Models settings save host defaults and apply them to a fresh chat", async ({ page }) => {
	await openWorkspaceChat(page);
	const defaults = await readDefaults(page);

	try {
		await connectFixtureProvider(page);
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

		await expect
			.poll(() => readDefaults(page))
			.toMatchObject({
				defaultModel: { provider: "e2e-central", id: modelId },
				defaultEffort: "high",
			});
		expect(await withHostWire(page, (wire) => wire.request("model.default", {}))).toMatchObject({
			model: { provider: "e2e-central", id: modelId },
			thinkingLevel: "high",
		});

		mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
		await section.screenshot({ path: SCREENSHOT_PATH, animations: "disabled" });

		await page.keyboard.press("Escape");
		await openFreshChat(page);
		const freshChatModel = page.getByTestId("model-selector").last();
		await expect(freshChatModel).toBeVisible();
		await expect(freshChatModel).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText("high");

		await disconnectFixtureProvider(page);
	} finally {
		await restoreDefaults(page, defaults);
	}
});

test("without saved defaults, Settings and a fresh chat use the first available model and clamped medium effort", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const defaults = await readDefaults(page);

	try {
		await connectFixtureProvider(page);
		await page.keyboard.press("Escape");
		const resolved = await withHostWire(page, async (wire): Promise<ModelDefault> => {
			const config = await wire.request("settings.update", {
				config: { defaultModel: null, defaultEffort: null },
			});
			expect(config).not.toHaveProperty("defaultModel");
			expect(config).not.toHaveProperty("defaultEffort");
			return wire.request("model.default", {});
		});
		expect(resolved.model).not.toBeNull();
		const modelName = resolved.model?.name ?? "";
		const effortLevel = resolved.thinkingLevel;

		await openProviders(page);
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		await expect(section.getByTestId("model-selector")).toContainText(modelName);
		await expect(section.getByTestId("thinking-selector")).toContainText(effortLevel);

		await page.keyboard.press("Escape");
		await openFreshChat(page);
		await expect(page.getByTestId("model-selector").last()).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText(effortLevel);

		await disconnectFixtureProvider(page);
	} finally {
		await restoreDefaults(page, defaults);
	}
});
