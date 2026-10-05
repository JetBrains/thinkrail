import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_CENTRAL_EXTENSION_SOURCE, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { E2eWire } from "./fixtures/wire";

const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
const modelId = "gpt-5.5";
const providers = ["openai", "openai-codex", "context-proxy"];
const seed = {
	providers: {
		openai: {
			headers: { "X-Private": "CONTEXT_PRIVATE_HEADER_SENTINEL" },
			modelOverrides: {
				"gpt-5.5": { name: "GPT-5.5 fixture", maxTokens: 4096 },
				"gpt-5": { contextWindow: 350_000 },
			},
		},
	},
};
let workspace: Workspace;
let wire: E2eWire;

async function openModels(page: Page): Promise<void> {
	await openProviders(page);
	await page.getByTestId("settings-nav-models").click();
}

async function setting(provider: string) {
	return (await wire.request("model.contextSettings", {})).find(
		(model) => model.provider === provider && model.id === modelId,
	);
}

async function expectOverrides(expected: number | null): Promise<void> {
	for (const provider of providers) {
		await expect.poll(async () => (await setting(provider))?.override).toBe(expected);
	}
}

async function choose(
	page: Page,
	target: string,
	preset: "default" | "1m" | "custom",
): Promise<void> {
	const control = page.getByTestId(`context-limit-${target}-${preset}`);
	await expect(control.getByRole("radio")).toBeEnabled();
	await control.click();
	await expect(control.getByRole("radio")).toBeChecked();
}

function savedConfig(): unknown {
	return JSON.parse(readFileSync(modelsPath, "utf8"));
}

test.beforeEach(async ({ page }) => {
	workspace = await openWorkspaceChat(page);
	copyFileSync(
		new URL("./fixtures/context-extension.ts.fixture", import.meta.url),
		E2E_CENTRAL_EXTENSION_SOURCE,
	);
	writeFileSync(modelsPath, JSON.stringify(seed));
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await page.getByTestId("settings-nav-models").click();
	await expect(page.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();
	wire = await E2eWire.connect(Number(new URL(page.url()).port));
});

test.afterEach(async () => {
	chmodSync(modelsPath, 0o600);
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	if (wire) {
		try {
			await wire.request("provider.jbcentralDisconnect", {});
		} finally {
			wire.close();
		}
	}
	copyFileSync(
		new URL("./fixtures/central-extension.ts.fixture", import.meta.url),
		E2E_CENTRAL_EXTENSION_SOURCE,
	);
});

test("one shared selector sets 1M for API, Codex and proxy models and Default removes it again", async ({
	page,
}) => {
	const model = (await wire.request("model.list", {})).find(
		(entry) => entry.provider === "openai" && entry.id === modelId,
	);
	if (!model) throw new Error("Missing test-owned OpenAI model");
	const oldChat = await wire.request("session.create", { workspaceId: workspace.id, model });
	expect(oldChat.model?.contextWindow).toBe(272_000);
	await expect(page.getByTestId(`context-limit-openai-${modelId}`)).toHaveCount(0);
	await shot(page.getByTestId("settings-model-context"), "models-settings", "context-default");

	await choose(page, "all", "1m");
	await expectOverrides(1_000_000);
	const settings = await wire.request("model.contextSettings", {});
	expect(settings).toHaveLength(3);
	expect(JSON.stringify(settings)).not.toContain("CONTEXT_PRIVATE");
	const newChat = await wire.request("session.create", { workspaceId: workspace.id, model });
	expect(newChat.model?.contextWindow).toBe(1_000_000);
	const live = await wire.request("session.list", { workspaceId: workspace.id });
	expect(
		live.find((session) => session.sessionId === oldChat.sessionId)?.model?.contextWindow,
	).toBe(272_000);

	await page.reload();
	await openModels(page);
	await expect(page.getByTestId("context-limit-all-1m").getByRole("radio")).toBeChecked();
	await shot(page.getByTestId("settings-model-context"), "models-settings", "context-extended");
	await choose(page, "all", "default");
	await expectOverrides(null);
	expect(savedConfig()).toEqual(seed);
});

test("shared changes reach every provider row and uniform row changes flow back to the shared control", async ({
	page,
}) => {
	const rows = providers.map((provider) => `${provider}-${modelId}`);
	const shared = page.getByTestId("context-limit-all");
	const checked = async (target: string, preset: "default" | "1m" | "custom") => {
		await expect(
			page.getByTestId(`context-limit-${target}-${preset}`).getByRole("radio"),
		).toBeChecked();
	};
	await page.getByTestId("model-context-customize").click();
	for (const row of rows) await checked(row, "default");

	await choose(page, "all", "1m");
	await expectOverrides(1_000_000);
	for (const row of rows) await checked(row, "1m");

	await choose(page, "all", "custom");
	await page.getByTestId("context-limit-all-input").fill("600000");
	await page.getByTestId("context-limit-all-input").press("Enter");
	await expectOverrides(600_000);
	for (const row of rows) {
		await checked(row, "custom");
		await expect(page.getByTestId(`context-limit-${row}-input`)).toHaveValue("600000");
	}

	await choose(page, "all", "default");
	await expectOverrides(null);
	for (const row of rows) await checked(row, "default");

	await choose(page, rows[0], "1m");
	await expect(shared).toHaveAttribute("data-context-override", "mixed");
	await expect(shared.getByRole("radio", { checked: true })).toHaveCount(0);
	await choose(page, "all", "1m");
	await expectOverrides(1_000_000);
	for (const row of rows) await checked(row, "1m");

	await choose(page, rows[0], "default");
	await choose(page, rows[1], "default");
	await expect(shared).toHaveAttribute("data-context-override", "mixed");
	await choose(page, rows[2], "default");
	await checked("all", "default");
	await expectOverrides(null);

	for (const row of rows) {
		await choose(page, row, "custom");
		await page.getByTestId(`context-limit-${row}-input`).fill("750000");
		await page.getByTestId(`context-limit-${row}-apply`).click();
		await expect(page.getByTestId(`context-limit-${row}`)).toHaveAttribute(
			"data-context-override",
			"750000",
		);
	}
	await expect(shared).toHaveAttribute("data-context-override", "750000");
	await checked("all", "custom");
	await expect(page.getByTestId("context-limit-all-input")).toHaveValue("750000");
	await expectOverrides(750_000);
});

test("shared saves leave an override set outside the app range alone until its own row changes it", async ({
	page,
}) => {
	writeFileSync(
		modelsPath,
		JSON.stringify({
			providers: {
				"context-proxy": { modelOverrides: { [modelId]: { contextWindow: 1_050_000 } } },
			},
		}),
	);
	await page.reload();
	await openModels(page);
	const shared = page.getByTestId("context-limit-all");
	await expect(shared).toContainText("2 available models \u00b7 1 kept at a limit set outside");
	await expect(shared.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();

	await choose(page, "all", "1m");
	for (const provider of ["openai", "openai-codex"]) {
		await expect.poll(async () => (await setting(provider))?.override).toBe(1_000_000);
	}
	expect((await setting("context-proxy"))?.override).toBe(1_050_000);
	await choose(page, "all", "default");
	for (const provider of ["openai", "openai-codex"]) {
		await expect.poll(async () => (await setting(provider))?.override).toBeNull();
	}
	expect((await setting("context-proxy"))?.override).toBe(1_050_000);

	await page.getByTestId("model-context-customize").click();
	const row = `context-proxy-${modelId}`;
	await expect(page.getByTestId(`context-limit-${row}-input`)).toHaveValue("1050000");
	await expect(page.getByTestId(`context-limit-${row}-input`)).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(page.getByTestId(`context-limit-${row}-apply`)).toBeDisabled();
	await choose(page, row, "default");
	await expect.poll(async () => (await setting("context-proxy"))?.override).toBeNull();
	await expect(shared).toContainText("3 available models");
	await expect(shared).not.toContainText("kept at a limit");
});

test("expanded customization isolates the same model on different providers", async ({ page }) => {
	await choose(page, "all", "1m");
	await page.getByTestId("model-context-customize").click();
	await expect(page.getByTestId("model-context-customize")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await expect(page.getByRole("radiogroup", { name: /context-proxy/ })).toHaveCount(1);
	await choose(page, `context-proxy-${modelId}`, "default");
	await expect.poll(async () => (await setting("context-proxy"))?.override).toBeNull();
	for (const provider of ["openai", "openai-codex"]) {
		expect((await setting(provider))?.override).toBe(1_000_000);
	}
	await expect(page.getByTestId("context-limit-all")).toContainText("Customized by model");
	await expect(
		page.getByTestId("context-limit-all").getByRole("radio", { checked: true }),
	).toHaveCount(0);
	await shot(page.getByTestId("settings-model-context"), "models-settings", "context-per-provider");
	await page.reload();
	await openModels(page);
	await expect(page.getByTestId("context-limit-all")).toContainText("Customized by model");
});

test("custom budgets require explicit Apply, validate the 272K–1M range and keep unrelated config", async ({
	page,
}) => {
	await page.getByTestId("model-context-customize").click();
	const target = `openai-${modelId}`;
	await choose(page, target, "custom");
	const input = page.getByTestId(`context-limit-${target}-input`);
	const apply = page.getByTestId(`context-limit-${target}-apply`);
	for (const invalid of ["", "0", "1.5", "271999", "1000001"]) {
		await input.fill(invalid);
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await expect(apply).toBeDisabled();
	}
	await input.fill("750000");
	await expect(apply).toBeEnabled();
	expect((await setting("openai"))?.override).toBeNull();
	await apply.click();
	await expect(page.getByTestId(`context-limit-${target}`)).toHaveAttribute(
		"data-context-override",
		"750000",
	);
	await expect(apply).toBeDisabled();
	await expect(input).toBeFocused();
	await expect.poll(async () => (await setting("openai"))?.contextWindow).toBe(750_000);
	expect((await setting("openai-codex"))?.override).toBeNull();
	await page.reload();
	await openModels(page);
	await page.getByTestId("model-context-customize").click();
	await expect(page.getByTestId(`context-limit-${target}-input`)).toHaveValue("750000");
	await shot(page.getByTestId("settings-model-context"), "models-settings", "context-custom");

	await choose(page, "all", "custom");
	await page.getByTestId("context-limit-all-input").fill("600000");
	await page.getByTestId("context-limit-all-input").press("Enter");
	await expect(page.getByTestId("context-limit-all")).toHaveAttribute(
		"data-context-override",
		"600000",
	);
	await expectOverrides(600_000);
	const saved = savedConfig() as typeof seed;
	expect(saved.providers.openai.headers).toEqual(seed.providers.openai.headers);
	expect(saved.providers.openai.modelOverrides[modelId].maxTokens).toBe(4096);
	expect(saved.providers.openai.modelOverrides["gpt-5"].contextWindow).toBe(350_000);
});

test("another connected frontend converges and drops its invalidated drafts", async ({
	page,
	context,
}) => {
	const peer = await context.newPage();
	try {
		await peer.goto(page.url());
		await openModels(peer);
		await choose(peer, "all", "custom");
		await peer.getByTestId("context-limit-all-input").fill("500000");
		await choose(page, "all", "1m");
		await expect(peer.getByTestId("context-limit-all-1m").getByRole("radio")).toBeChecked();
		await expect(peer.getByTestId("context-limit-all-input")).toHaveCount(0);
		await choose(peer, "all", "default");
		await expect(page.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();
		await page.getByTestId("model-context-customize").click();
		await choose(page, `openai-${modelId}`, "1m");
		await expect(peer.getByTestId("context-limit-all")).toContainText("Customized by model");
	} finally {
		await peer.close();
	}
});

test("read and write failures disclose no configuration and Retry reloads the saved limits", async ({
	page,
}) => {
	const section = page.getByTestId("settings-model-context");
	writeFileSync(modelsPath, "CONTEXT_PRIVATE_MALFORMED_SENTINEL");
	await page.keyboard.press("Escape");
	await openModels(page);
	await expect(section.getByRole("alert")).toBeVisible();
	await expect(section.getByRole("radio")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText("CONTEXT_PRIVATE");
	await shot(section, "models-settings", "context-read-error");
	writeFileSync(modelsPath, JSON.stringify(seed));
	await section.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();

	const before = readFileSync(modelsPath, "utf8");
	chmodSync(modelsPath, 0o400);
	await page.getByTestId("context-limit-all-1m").click();
	await expect(section.getByRole("alert")).toBeVisible();
	expect(readFileSync(modelsPath, "utf8")).toBe(before);
	chmodSync(modelsPath, 0o600);
	await section.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();
});

test("the compact selector supports keyboard changes at mobile width", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const section = page.getByTestId("settings-model-context");
	await page.getByTestId("context-limit-all-default").getByRole("radio").focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("context-limit-all-1m").getByRole("radio")).toBeChecked();
	await expectOverrides(1_000_000);
	await expect(page.getByTestId("context-limit-all-1m").getByRole("radio")).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByTestId("context-limit-all-default").getByRole("radio")).toBeChecked();
	expect(await section.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
		false,
	);
	await shot(section, "models-settings", "context-mobile");
});

test("pre-v76 hosts hide context controls without sending unsupported requests", async ({
	page,
}) => {
	let reads = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as { method?: string };
			if (frame.method === "model.contextSettings" || frame.method === "model.setContextWindow")
				reads++;
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: Record<string, unknown>;
			};
			browser.send(
				frame.channel === "server.welcome"
					? JSON.stringify({
							...frame,
							data: {
								...frame.data,
								protocolVersion: CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION - 1,
							},
						})
					: message,
			);
		});
	});
	await page.reload();
	await openModels(page);
	await expect(page.getByTestId("settings-models")).toBeVisible();
	await expect(page.getByTestId("settings-model-context")).toHaveCount(0);
	expect(reads).toBe(0);
});
