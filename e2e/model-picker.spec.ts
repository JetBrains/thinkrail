import { expect, type Page, test } from "@playwright/test";
import type { AppConfig, ThinkingLevel } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { shot } from "./fixtures/screenshots";
import { E2eWire } from "./fixtures/wire";

const CENTRAL_OPTION = '[data-testid="model-option"][data-model-id="e2e-central-model"]';

async function withHostWire<T>(page: Page, run: (wire: E2eWire) => Promise<T>): Promise<T> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

async function readConfig(page: Page): Promise<AppConfig> {
	return withHostWire(page, (wire) => wire.request("settings.update", { config: {} }));
}

async function openFreshChat(page: Page): Promise<void> {
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const previousChatCount = await chatTabs.count();
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(previousChatCount + 1);
}

/** The Central chat's level as the host holds it — optimistic pill text may run ahead of pi's echo. */
async function hostLevel(page: Page, workspaceId: string): Promise<ThinkingLevel | undefined> {
	const sessions = await withHostWire(page, (wire) =>
		wire.request("session.list", { workspaceId }),
	);
	return sessions.find((session) => session.model?.id === "e2e-central-model")?.thinkingLevel;
}

async function connectFixtureProvider(page: Page): Promise<void> {
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await page.keyboard.press("Escape");
}

async function disconnectFixtureProvider(page: Page): Promise<void> {
	await openProviders(page);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	await page.keyboard.press("Escape");
}

test("the composer pill stars a favorite, records it as recent, and saves the pair as default", async ({
	page,
}) => {
	const workspace = await openWorkspaceChat(page);
	const before = await readConfig(page);

	try {
		await connectFixtureProvider(page);
		await openFreshChat(page);
		const pill = page.getByTestId("model-selector").last();
		await pill.click();
		const option = page.locator(CENTRAL_OPTION).first();
		await expect(option).toBeVisible();
		await expect(option).toContainText("quota");
		await expect(page.getByTestId("thinking-section")).toBeVisible();
		await shot(page.getByTestId("chat-composer"), "model-picker", "composer-pill");
		await shot(
			page.locator("[data-radix-popper-content-wrapper]").first(),
			"model-picker",
			"popover",
		);

		await option.locator('[data-testid="model-favorite-toggle"]').click();
		await expect
			.poll(async () => (await readConfig(page)).favoriteModels.map((m) => m.id))
			.toEqual(["e2e-central-model"]);
		await expect(page.locator("[cmdk-group-heading]", { hasText: "Favorites" })).toBeVisible();
		await expect(page.getByTestId("model-show-all")).toBeVisible();

		await option.click();
		await expect(page.getByTestId("thinking-section")).toContainText(
			"Synthetic JetBrains AI model",
		);
		await expect(pill).toContainText("Synthetic JetBrains AI model");
		await expect
			.poll(async () => (await readConfig(page)).recentModels.map((m) => m.id))
			.toEqual(["e2e-central-model"]);

		const high = page.locator('[data-testid="thinking-option"][data-level="high"]');
		await expect(high).toBeVisible();
		await high.click();
		await expect(high).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByTestId("thinking-selector").last()).toContainText("high");
		await expect.poll(() => hostLevel(page, workspace.id)).toBe("high");
		const slider = page.getByTestId("thinking-slider");
		await slider.focus();
		await page.keyboard.press("ArrowLeft");
		await expect(page.getByTestId("thinking-selector").last()).toContainText("medium");
		await expect.poll(() => hostLevel(page, workspace.id)).toBe("medium");
		await expect(slider).toHaveAttribute("aria-valuetext", "medium");
		await high.click();
		await expect.poll(() => hostLevel(page, workspace.id)).toBe("high");
		await shot(
			page.locator("[data-radix-popper-content-wrapper]").first(),
			"model-picker",
			"popover-after",
		);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("model-option")).toHaveCount(0);

		await pill.click();
		await page.getByTestId("model-set-default").click();
		await expect
			.poll(() => readConfig(page))
			.toMatchObject({
				defaultModel: { provider: "e2e-central", id: "e2e-central-model" },
				defaultEffort: "high",
			});
		await expect(page.getByTestId("model-set-default")).toHaveAttribute("data-default", "true");
		const reset = page.getByTestId("thinking-reset");
		await expect(reset).toHaveCount(0);
		await slider.focus();
		await page.keyboard.press("ArrowLeft");
		await expect.poll(() => hostLevel(page, workspace.id)).toBe("medium");
		await expect(reset).toContainText("reset to high");
		await reset.click();
		await expect.poll(() => hostLevel(page, workspace.id)).toBe("high");
		await expect(reset).toHaveCount(0);
		await page.keyboard.press("Escape");

		await pill.click();
		await page
			.locator(CENTRAL_OPTION)
			.first()
			.locator('[data-testid="model-favorite-toggle"]')
			.click();
		await expect.poll(async () => (await readConfig(page)).favoriteModels).toEqual([]);
		await page.keyboard.press("Escape");
		await disconnectFixtureProvider(page);
	} finally {
		await withHostWire(page, (wire) =>
			wire.request("settings.update", {
				config: {
					favoriteModels: before.favoriteModels,
					defaultModel: before.defaultModel ?? null,
					defaultEffort: before.defaultEffort ?? null,
				},
			}),
		);
	}
});

test("/model opens the picker with the typed search instead of sending a message", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");
	await input.fill("/model synthetic");
	await input.press("Enter");
	await expect(page.locator("[cmdk-input]")).toHaveValue("synthetic");
	await expect(input).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(page.locator("[cmdk-input]")).toHaveCount(0);
});

test("the new-workspace dialog follows the host default until a model is picked explicitly", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	try {
		await connectFixtureProvider(page);
		await page.getByTestId("add-workspace").first().click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		const pill = dialog.getByTestId("model-selector");
		await expect(pill).toContainText("Default");
		const resolved = await withHostWire(page, (wire) => wire.request("model.default", {}));
		if (!resolved.model) throw new Error("The fixture host resolved no default model");
		await expect(pill).toContainText(resolved.model.name);
		await expect(dialog.getByTestId("thinking-selector")).toContainText(resolved.thinkingLevel);

		await pill.click();
		const defaultRow = page.getByTestId("model-option-default");
		await expect(defaultRow).toContainText("Follows Settings → Models");
		const showAll = page.getByTestId("model-show-all");
		if ((await showAll.count()) > 0) await showAll.click();
		await page.locator(CENTRAL_OPTION).first().click();
		await expect(pill).not.toContainText("Default");
		await expect(pill).toContainText("Synthetic JetBrains AI model");
		await expect(page.getByTestId("thinking-section")).toBeVisible();

		await page.getByTestId("model-option-default").click();
		await expect(pill).toContainText("Default");
		await dialog.getByTestId("ws-target-default").click();
		await page.getByTestId("create-workspace").click();
		await expect(dialog).toBeHidden();
		const chatPill = page.getByTestId("model-selector").last();
		await expect(chatPill).toContainText(resolved.model.name);
		await expect(chatPill).not.toContainText("Synthetic JetBrains AI model");
		await disconnectFixtureProvider(page);
	} finally {
		await withHostWire(page, (wire) =>
			wire.request("settings.update", { config: { favoriteModels: [] } }),
		);
	}
});
