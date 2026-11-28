import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { AppConfig, ModelDefault } from "@thinkrail/contracts";
import {
	closeSettings,
	expandModelGroup,
	openWorkspaceChat,
	revealModelGroups,
} from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_PI_AGENT_DIR, E2E_SCREENSHOT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "models-settings", "default-model.png");
const MODELS_PATH = join(E2E_PI_AGENT_DIR, "models.json");
const LONG_MODEL_PREFIX = "accounts/e2e/models";
const LONG_CATALOG = {
	providers: {
		"e2e-long": {
			baseUrl: "http://127.0.0.1:9/v1",
			api: "openai-completions",
			apiKey: "e2e-long-catalog",
			models: Array.from({ length: 40 }, (_, index) => ({
				id: `${LONG_MODEL_PREFIX}/long-model-${String(index).padStart(2, "0")}`,
				name: "Long catalog model",
			})),
		},
	},
};

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
	await closeSettings(page);
}

async function popoverInsideDialog(page: Page): Promise<boolean> {
	const [popover, dialog] = await Promise.all([
		page.locator("[data-radix-popper-content-wrapper] > *").boundingBox(),
		page.getByTestId("settings-dialog").boundingBox(),
	]);
	if (!popover || !dialog) return false;
	return (
		popover.x >= dialog.x &&
		popover.y >= dialog.y &&
		popover.x + popover.width <= dialog.x + dialog.width &&
		popover.y + popover.height <= dialog.y + dialog.height
	);
}

async function openFreshChat(page: Page): Promise<void> {
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const previousChatCount = await chatTabs.count();
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(previousChatCount + 1);
}

async function holdReplies(page: Page) {
	let armed: { method: string; id?: string; held: () => void; release: Promise<void> } | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (browserSocket) => {
		const serverSocket = browserSocket.connectToServer();
		browserSocket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { id?: string; method?: string };
			if (armed && !armed.id && frame.method === armed.method && frame.id) armed.id = frame.id;
			serverSocket.send(message);
		});
		serverSocket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { id?: string };
			const pending = armed;
			if (pending?.id && frame.id === pending.id) {
				armed = undefined;
				pending.held();
				void pending.release.then(() => browserSocket.send(message));
				return;
			}
			browserSocket.send(message);
		});
	});
	return {
		arm(method: string) {
			let held = () => {};
			let release = () => {};
			const heldP = new Promise<void>((resolve) => {
				held = resolve;
			});
			const releaseP = new Promise<void>((resolve) => {
				release = resolve;
			});
			armed = { method, held, release: releaseP };
			return { held: heldP, release };
		},
	};
}

test("Models settings save host defaults through the chat's model and effort picker and apply them to a fresh chat", async ({
	page,
}) => {
	const replies = await holdReplies(page);
	await openWorkspaceChat(page);
	const defaults = await readDefaults(page);

	try {
		await connectFixtureProvider(page);
		const dialog = page.getByTestId("settings-dialog");
		await expect(dialog).toBeVisible();
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		await expect(section).toContainText("Default model");
		const row = section.getByTestId("default-model-row");
		await expect(row).toContainText("Chat model");

		const modelSelector = row.getByTestId("model-selector");
		await expect(modelSelector).toBeVisible();
		await modelSelector.focus();
		await page.keyboard.press("Enter");
		await expect(modelSelector).toHaveAttribute("data-open", "true");
		await expect(page.getByTestId("model-set-default")).toHaveCount(0);
		await revealModelGroups(page);
		await expandModelGroup(page, "e2e-central");
		const modelOption = page
			.locator('[data-testid="model-option"][data-model-id="e2e-central-model"]')
			.last();
		await expect(modelOption).toBeVisible();
		const modelId = await modelOption.getAttribute("data-model-id");
		const modelName = (
			await modelOption.locator("span.flex.min-w-0 > span").first().textContent()
		)?.trim();
		if (!modelId || !modelName)
			throw new Error("The model catalog returned an incomplete model option");
		const effortSelector = row.getByTestId("thinking-selector");
		const modelSave = replies.arm("settings.update");
		await modelOption.click();
		await modelSave.held;
		await expect(modelSelector).toContainText(modelName);
		await expect(modelSelector).toHaveAttribute("data-open", "true");
		await expect(page.getByTestId("thinking-section")).toContainText(modelName);
		modelSave.release();
		await expect(row.getByTestId("settings-reset-chat-model")).toBeVisible();

		const effortOption = page.locator('[data-testid="thinking-option"][data-level="high"]');
		await expect(effortOption).toBeVisible();
		const effortSave = replies.arm("settings.update");
		await effortOption.click();
		await effortSave.held;
		await expect(effortSelector).toContainText("high");
		effortSave.release();
		await page.keyboard.press("Escape");
		await expect(modelSelector).toHaveAttribute("data-open", "false");
		await expect(modelSelector).toBeFocused();
		await expect(dialog).toBeVisible();
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

		await closeSettings(page);
		await openFreshChat(page);
		const freshChatModel = page.getByTestId("model-selector").last();
		await expect(freshChatModel).toBeVisible();
		await expect(freshChatModel).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText("high");

		await openProviders(page);
		await page.getByTestId("settings-nav-models").click();
		await row.getByTestId("settings-reset-chat-model").click();
		await expect.poll(() => readDefaults(page)).toEqual({});
		await expect(row.getByTestId("settings-reset-chat-model")).toHaveCount(0);
		await closeSettings(page);

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
		await closeSettings(page);
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
		const row = page.getByTestId("settings-models").getByTestId("default-model-row");
		await expect(row.getByTestId("model-selector")).toContainText(modelName);
		await expect(row.getByTestId("thinking-selector")).toContainText(effortLevel);
		await expect(row.getByTestId("settings-reset-chat-model")).toHaveCount(0);

		await closeSettings(page);
		await openFreshChat(page);
		await expect(page.getByTestId("model-selector").last()).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText(effortLevel);

		await disconnectFixtureProvider(page);
	} finally {
		await restoreDefaults(page, defaults);
	}
});

test("the Settings model pickers open inside the dialog, and the model list scrolls with the wheel", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	writeFileSync(MODELS_PATH, JSON.stringify(LONG_CATALOG));

	try {
		await connectFixtureProvider(page);
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		const list = page.locator("[cmdk-list]");
		for (const viewport of [
			{ width: 1280, height: 720 },
			{ width: 1280, height: 400 },
			{ width: 320, height: 568 },
		]) {
			await page.setViewportSize(viewport);
			for (const row of ["default-model-row", "review-model-row"]) {
				const trigger = section.getByTestId(row).getByTestId("model-selector");
				await trigger.click();
				await revealModelGroups(page);
				await expandModelGroup(page, "e2e-long");
				await expect(
					list.locator(`[data-model-id="${LONG_MODEL_PREFIX}/long-model-39"]`),
				).toBeAttached();
				await list.evaluate((element) => element.scrollTo({ top: 0 }));
				await list.hover();
				await page.mouse.wheel(0, 600);
				await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
				await expect.poll(() => popoverInsideDialog(page)).toBe(true);
				await expect(page.getByTestId("model-refresh")).toBeInViewport({ ratio: 1 });
				await expect(page.getByTestId("model-set-default")).toHaveCount(0);
				await page.keyboard.press("Escape");
				await expect(list).toHaveCount(0);
				await expect(trigger).toBeFocused();
			}
		}
	} finally {
		writeFileSync(MODELS_PATH, JSON.stringify({ providers: {} }));
		await withHostWire(page, (wire) => wire.request("provider.jbcentralDisconnect", {}));
	}
});

test("Settings and composer open on the current model and copy its full ID without selecting", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openWorkspaceChat(page);
	const before = await withHostWire(page, (wire) =>
		wire.request("settings.update", { config: {} }),
	);
	writeFileSync(MODELS_PATH, JSON.stringify(LONG_CATALOG));

	try {
		await connectFixtureProvider(page);
		const models = await withHostWire(page, (wire) => wire.request("model.list", {}));
		const current = models.find((model) => model.id === `${LONG_MODEL_PREFIX}/long-model-39`);
		const other = models.find((model) => model.id === `${LONG_MODEL_PREFIX}/long-model-00`);
		if (!current || !other) throw new Error("The long catalog fixture was not loaded");
		const modelRef = { provider: current.provider, id: current.id };
		await withHostWire(page, (wire) =>
			wire.request("settings.update", {
				config: {
					defaultModel: current,
					defaultEffort: "off",
					reviewModel: current,
					reviewEffort: "off",
					favoriteModels: [other],
				},
			}),
		);
		await page.getByTestId("settings-nav-models").click();
		await page.setViewportSize({ width: 320, height: 568 });
		const list = page.locator("[cmdk-list]");
		const currentRow = list
			.locator(`[data-testid="model-option"][data-model-id="${current.id}"]`)
			.first();
		const copy = list
			.locator(`[data-testid="model-option"][data-model-id="${other.id}"]`)
			.first()
			.getByTestId("chat-copy");
		for (const row of ["default-model-row", "review-model-row"]) {
			const trigger = page.getByTestId(row).getByTestId("model-selector");
			await expect(trigger).toHaveAttribute("title", new RegExp(current.id));
			await trigger.click();
			await expect(currentRow).toHaveAttribute("aria-selected", "true");
			await expect(currentRow).toBeInViewport({ ratio: 1 });
			await expect(currentRow).toHaveAccessibleName(new RegExp(current.id));
			await copy.focus();
			await copy.press("Enter");
			await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(other.id);
			await expect(copy).toHaveAttribute("data-copied", "true");
			await expect(trigger).toHaveAttribute("data-open", "true");
			expect(await readDefaults(page)).toMatchObject({ defaultModel: modelRef });
			expect(
				await withHostWire(page, (wire) => wire.request("settings.update", { config: {} })),
			).toMatchObject({ reviewModel: modelRef });
			await page.keyboard.press("Escape");
		}

		await closeSettings(page);
		await openFreshChat(page);
		const trigger = page.getByTestId("model-selector").last();
		await expect(trigger).toHaveAttribute("title", new RegExp(current.id));
		await trigger.click();
		await expect(currentRow).toHaveAttribute("aria-selected", "true");
		await expect(currentRow).toBeInViewport({ ratio: 1 });
		await copy.click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(other.id);
		await expect(copy).toHaveAttribute("data-copied", "true");
		await expect(trigger).toHaveAttribute("data-open", "true");
		await expect(trigger).toHaveAttribute("title", new RegExp(current.id));
		await page.keyboard.press("Escape");
	} finally {
		writeFileSync(MODELS_PATH, JSON.stringify({ providers: {} }));
		await withHostWire(page, async (wire) => {
			try {
				await wire.request("settings.update", {
					config: {
						defaultModel: before.defaultModel ?? null,
						defaultEffort: before.defaultEffort ?? null,
						reviewModel: before.reviewModel ?? null,
						reviewEffort: before.reviewEffort ?? null,
						favoriteModels: before.favoriteModels,
					},
				});
			} finally {
				await wire.request("provider.jbcentralDisconnect", {});
			}
		});
	}
});
