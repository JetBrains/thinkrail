import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { AppConfig, ModelDefault } from "@thinkrail/contracts";
import { expandModelGroup, openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_PI_AGENT_DIR, E2E_SCREENSHOT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const SCREENSHOT_PATH = join(E2E_SCREENSHOT_DIR, "models-settings", "default-model.png");
const MODELS_PATH = join(E2E_PI_AGENT_DIR, "models.json");
const LONG_CATALOG = {
	providers: {
		"e2e-long": {
			baseUrl: "http://127.0.0.1:9/v1",
			api: "openai-completions",
			apiKey: "e2e-long-catalog",
			models: Array.from({ length: 40 }, (_, index) => ({
				id: `long-model-${String(index).padStart(2, "0")}`,
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

test("Models settings save host defaults and apply them to a fresh chat", async ({ page }) => {
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
		await modelSelector.click();
		await expandModelGroup(page, "e2e-central");
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
		const effortSelector = row.getByTestId("thinking-selector");
		const modelSave = replies.arm("settings.update");
		await modelOption.click();
		await modelSave.held;
		await expect(modelSelector).toBeFocused();
		await expect(modelSelector).toBeDisabled();
		await expect(effortSelector).toBeDisabled();
		await page.keyboard.press("Enter");
		modelSave.release();
		await expect(modelSelector).toContainText(modelName);
		await expect(effortSelector).toBeEnabled();
		await expect(modelSelector).toHaveAttribute("data-open", "false");

		await expect(effortSelector).toBeEnabled();
		await effortSelector.click();
		const effortOption = page.locator('[data-testid="thinking-option"][data-level="high"]');
		await expect(effortOption).toBeVisible();
		const effortSave = replies.arm("settings.update");
		await effortOption.click();
		await effortSave.held;
		await expect(effortSelector).toBeFocused();
		await expect(effortSelector).toBeDisabled();
		await page.keyboard.press("Enter");
		effortSave.release();
		await expect(effortSelector).toBeEnabled();
		await expect(effortSelector).toHaveAttribute("data-open", "false");
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
		const row = page.getByTestId("settings-models").getByTestId("default-model-row");
		await expect(row.getByTestId("model-selector")).toContainText(modelName);
		await expect(row.getByTestId("thinking-selector")).toContainText(effortLevel);

		await page.keyboard.press("Escape");
		await openFreshChat(page);
		await expect(page.getByTestId("model-selector").last()).toContainText(modelName);
		await expect(page.getByTestId("thinking-selector").last()).toContainText(effortLevel);

		await disconnectFixtureProvider(page);
	} finally {
		await restoreDefaults(page, defaults);
	}
});

test("the Settings model and effort pickers open inside the dialog, and the model list scrolls with the wheel", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	writeFileSync(MODELS_PATH, JSON.stringify(LONG_CATALOG));

	try {
		await connectFixtureProvider(page);
		await page.getByTestId("settings-nav-models").click();
		const section = page.getByTestId("settings-models");
		const list = page.locator("[cmdk-list]");
		const effortOptions = page.getByTestId("thinking-option");
		for (const viewport of [
			{ width: 1280, height: 720 },
			{ width: 1280, height: 400 },
			{ width: 320, height: 568 },
		]) {
			await page.setViewportSize(viewport);
			for (const row of ["default-model-row", "review-model-row"]) {
				const target = section.getByTestId(row);
				await target.getByTestId("model-selector").click();
				await expandModelGroup(page, "e2e-long");
				await expect(list.locator('[data-model-id="long-model-39"]')).toBeAttached();
				await list.evaluate((element) => element.scrollTo({ top: 0 }));
				await list.hover();
				await page.mouse.wheel(0, 600);
				await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
				await expect.poll(() => popoverInsideDialog(page)).toBe(true);
				await expect(page.getByTestId("model-refresh")).toBeInViewport({ ratio: 1 });
				await page.keyboard.press("Escape");
				await expect(list).toHaveCount(0);

				await target.getByTestId("thinking-selector").click();
				await expect(effortOptions.first()).toBeVisible();
				await expect.poll(() => popoverInsideDialog(page)).toBe(true);
				await effortOptions.first().hover();
				await page.mouse.wheel(0, 300);
				await expect(effortOptions.last()).toBeInViewport({ ratio: 1 });
				await page.keyboard.press("Escape");
				await expect(effortOptions).toHaveCount(0);
			}
		}
	} finally {
		writeFileSync(MODELS_PATH, JSON.stringify({ providers: {} }));
		await withHostWire(page, (wire) => wire.request("provider.jbcentralDisconnect", {}));
	}
});
