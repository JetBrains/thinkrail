import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CUSTOM_ENDPOINT_API_PROTOCOL_VERSION } from "@thinkrail/contracts";
import {
	closeSettings,
	expandModelGroup,
	openWorkspaceChat,
	revealModelGroups,
	waitForAgentSettled,
} from "./fixtures/app";
import { openProviders } from "./fixtures/jbcentral";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { E2eWire } from "./fixtures/wire";

const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
const KEY = "sk-gateway-e2e";
const MODEL = "qwen3-coder-gateway";
const UNREPORTED = "context-not-reported";
const REPLY = "CUSTOM_ENDPOINT_REPLY_SENTINEL";
let server: Server;
let origin: string;
const chatRequests: Record<string, unknown>[] = [];
const responseRequests: Record<string, unknown>[] = [];

function sse(chunks: unknown[]): string {
	return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

test.beforeAll(async () => {
	server = createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${KEY}`) {
			response.statusCode = 401;
			response.end();
			return;
		}
		if (request.method === "GET" && request.url === "/v1/models") {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					object: "list",
					data: [
						{ id: MODEL, object: "model", owned_by: "sglang", max_model_len: 65_536 },
						{ id: UNREPORTED, object: "model", owned_by: "sglang" },
					],
				}),
			);
			return;
		}
		if (request.method === "POST" && request.url === "/v1/chat/completions") {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				chatRequests.push(JSON.parse(body));
				const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: MODEL };
				response.setHeader("content-type", "text/event-stream");
				response.end(
					sse([
						{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: REPLY } }] },
						{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
						{
							...base,
							choices: [],
							usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
						},
					]),
				);
			});
			return;
		}
		if (request.method === "POST" && request.url === "/v1/responses") {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				responseRequests.push(JSON.parse(body));
				const item = {
					id: "msg_1",
					type: "message",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: REPLY, annotations: [] }],
				};
				response.setHeader("content-type", "text/event-stream");
				response.end(
					sse([
						{ type: "response.created", response: { id: "resp_1" } },
						{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
						{ type: "response.output_text.delta", output_index: 0, delta: REPLY },
						{ type: "response.output_item.done", output_index: 0, item },
						{
							type: "response.completed",
							response: { id: "resp_1", status: "completed", output: [item] },
						},
					]),
				);
			});
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("The fake server has no port.");
	origin = `http://127.0.0.1:${address.port}`;
});

test("a Responses gateway keeps its API through editing and sends declared image input", async ({
	page,
}) => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	await openWorkspaceChat(page);
	await openProviders(page);
	const group = page.getByTestId("settings-custom-endpoints");
	await group.getByTestId("custom-endpoints-add").click();
	const dialog = page.getByTestId("custom-endpoints-dialog");
	const responses = dialog.getByTestId("custom-endpoints-api-responses");
	await expect(dialog.getByTestId("custom-endpoints-api-completions")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await responses.click();
	await dialog.getByTestId("custom-endpoints-name").fill("Responses gateway");
	await dialog.getByTestId("custom-endpoints-url").fill(`${origin}/v1/responses`);
	await dialog.getByTestId("custom-endpoints-key").fill(KEY);
	await dialog.getByTestId("custom-endpoints-detect").click();
	await expect(dialog.getByTestId("custom-endpoints-status")).toHaveAttribute("data-tone", "ok");
	await expect(dialog.getByTestId("custom-endpoints-url")).toHaveValue(`${origin}/v1`);
	await expect(responses).toHaveAttribute("aria-pressed", "true");
	await shot(dialog, "providers-settings", "custom-endpoint-responses");
	await dialog.getByTestId("custom-endpoints-save").click();
	await expect(dialog).toHaveCount(0);
	const endpoint = group.locator(
		'[data-testid="custom-endpoints-endpoint"][data-endpoint^="custom-responses-gateway-"]',
	);
	await expect(endpoint).toBeVisible();
	const providerId = (await endpoint.getAttribute("data-endpoint")) ?? "";
	const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
	expect(saved.providers[providerId]).toMatchObject({ api: "openai-responses" });
	saved.providers[providerId].name = "Vision Responses gateway";
	saved.providers[providerId].models[0].input = ["text", "image"];
	writeFileSync(modelsPath, JSON.stringify(saved));
	await page.getByTestId("providers-refresh").click();
	await expect(endpoint).toContainText("Vision Responses gateway");
	await endpoint.getByTestId("custom-endpoints-edit").click();
	await expect(responses).toHaveAttribute("aria-pressed", "true");
	await expect(
		dialog.locator(`[data-testid="custom-endpoints-row"][data-model="${MODEL}"]`),
	).toContainText("Images");
	await dialog.getByTestId("custom-endpoints-name").fill("Renamed Responses gateway");
	await dialog.getByTestId("custom-endpoints-save").click();
	await expect(dialog).toHaveCount(0);
	expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers[providerId]).toMatchObject({
		api: "openai-responses",
	});
	await closeSettings(page);
	await page.getByTestId("model-selector").last().click();
	await revealModelGroups(page);
	await expandModelGroup(page, providerId);
	await page
		.locator(
			`[data-testid="model-option"][data-provider="${providerId}"][data-model-id="${MODEL}"]`,
		)
		.click();
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
	await page
		.getByTestId("composer-attach-input")
		.setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
	await page.getByTestId("chat-input").fill("Describe this image");
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(REPLY);
	expect(responseRequests.at(-1)).toMatchObject({
		model: MODEL,
		stream: true,
		max_output_tokens: 16_384,
	});
	expect(responseRequests.at(-1)?.input).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				role: "user",
				content: expect.arrayContaining([
					expect.objectContaining({
						type: "input_image",
						image_url: `data:image/png;base64,${png.toString("base64")}`,
					}),
				]),
			}),
		]),
	);
	expect(responseRequests.at(-1)).not.toHaveProperty("messages");
	await openProviders(page);
	await endpoint.getByTestId("custom-endpoints-remove").click();
	await page.getByTestId("custom-endpoints-remove-confirm").click();
	await expect(endpoint).toHaveCount(0);
});

test("older hosts hide the API choice and receive a legacy Chat Completions save", async ({
	page,
}) => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	const saves: Record<string, unknown>[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				method?: string;
				params?: Record<string, unknown>;
			};
			if (frame.method === "customEndpoints.save" && frame.params) saves.push(frame.params);
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
							data: { ...frame.data, protocolVersion: CUSTOM_ENDPOINT_API_PROTOCOL_VERSION - 1 },
						})
					: message,
			);
		});
	});
	await page.reload();
	await openWorkspaceChat(page);
	await openProviders(page);
	const group = page.getByTestId("settings-custom-endpoints");
	await group.getByTestId("custom-endpoints-add").click();
	const dialog = page.getByTestId("custom-endpoints-dialog");
	await expect(dialog.getByTestId("custom-endpoints-api")).toHaveCount(0);
	await dialog.getByTestId("custom-endpoints-name").fill("Legacy gateway");
	await dialog.getByTestId("custom-endpoints-url").fill(`${origin}/v1`);
	await dialog.getByTestId("custom-endpoints-manual").fill(MODEL);
	await dialog.getByTestId("custom-endpoints-manual-add").click();
	await dialog.getByTestId("custom-endpoints-save").click();
	await expect(dialog).toHaveCount(0);
	expect(saves).toHaveLength(1);
	expect(saves[0]).not.toHaveProperty("api");
	const endpoint = group.getByTestId("custom-endpoints-endpoint");
	const providerId = (await endpoint.getAttribute("data-endpoint")) ?? "";
	expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers[providerId]).toMatchObject({
		api: "openai-completions",
	});
});

test.afterAll(async () => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a keyed gateway is found, saved to models.json, chatted with, edited and removed", async ({
	page,
}) => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	await openWorkspaceChat(page);
	await openProviders(page);
	const group = page.getByTestId("settings-custom-endpoints");
	await expect(group).toBeVisible();
	await expect(group.getByTestId("custom-endpoints-empty")).toContainText("No custom servers yet.");

	await group.getByTestId("custom-endpoints-add").click();
	const dialog = page.getByTestId("custom-endpoints-dialog");
	const status = dialog.getByTestId("custom-endpoints-status");
	await dialog.getByTestId("custom-endpoints-name").fill("Company gateway");
	await dialog.getByTestId("custom-endpoints-url").fill(origin);
	await dialog.getByTestId("custom-endpoints-detect").click();
	await expect(status).toHaveAttribute("data-tone", "error");

	await dialog.getByTestId("custom-endpoints-key").fill(KEY);
	await dialog.getByTestId("custom-endpoints-detect").click();
	await expect(status).toHaveAttribute("data-tone", "ok");
	await expect(dialog.getByTestId("custom-endpoints-url")).toHaveValue(`${origin}/v1`);
	const row = dialog.locator(`[data-testid="custom-endpoints-row"][data-model="${MODEL}"]`);
	await expect(row).toContainText("66K");
	const unreported = dialog.locator(
		`[data-testid="custom-endpoints-row"][data-model="${UNREPORTED}"]`,
	);
	await unreported.getByTestId("custom-endpoints-use").click();
	await expect(unreported.getByTestId("custom-endpoints-use")).toHaveAttribute(
		"aria-checked",
		"false",
	);
	await shot(dialog, "providers-settings", "custom-endpoint-dialog");
	await dialog.getByTestId("custom-endpoints-save").click();
	await expect(dialog).toHaveCount(0);

	const endpoint = group.locator(
		'[data-testid="custom-endpoints-endpoint"][data-endpoint^="custom-company-gateway-"]',
	);
	await expect(endpoint).toContainText(`${origin}/v1`);
	const providerId = (await endpoint.getAttribute("data-endpoint")) ?? "";
	const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
	expect(saved.providers[providerId]).toMatchObject({
		name: "Company gateway",
		api: "openai-completions",
		baseUrl: `${origin}/v1`,
		apiKey: KEY,
		compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" },
		models: [{ id: MODEL, contextWindow: 65_536, maxTokens: 16_384 }],
	});
	await expect(
		page.locator(`[data-testid="provider-row"][data-provider="${providerId}"]`),
	).toHaveCount(0);
	await shot(group, "providers-settings", "custom-endpoints");

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await expect
			.poll(async () =>
				(await wire.request("model.list", {})).some(
					(model) => model.provider === providerId && model.id === MODEL,
				),
			)
			.toBe(true);
		const status = await wire.request("provider.status", {});
		expect(status.providers.find((provider) => provider.id === providerId)?.configured).toBe(true);
		const listed = await wire.request("customEndpoints.list", {});
		expect(JSON.stringify(listed)).not.toContain(KEY);
	} finally {
		wire.close();
	}

	await closeSettings(page);
	await page.getByTestId("model-selector").last().click();
	await revealModelGroups(page);
	await expandModelGroup(page, providerId);
	await page
		.locator(
			`[data-testid="model-option"][data-provider="${providerId}"][data-model-id="${MODEL}"]`,
		)
		.click();
	await page.getByTestId("chat-input").fill("Say hello");
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(REPLY);
	expect(chatRequests.at(-1)).toMatchObject({ model: MODEL, stream: true, max_tokens: 16_384 });
	expect(chatRequests.at(-1)).not.toHaveProperty("store");

	const handSet = JSON.parse(readFileSync(modelsPath, "utf8"));
	handSet.providers[providerId].name = "Hand-set output";
	handSet.providers[providerId].models[0].maxTokens = 100_000;
	writeFileSync(modelsPath, JSON.stringify(handSet));
	await openProviders(page);
	await page.getByTestId("providers-refresh").click();
	await expect(endpoint).toContainText("Hand-set output");
	await endpoint.getByTestId("custom-endpoints-edit").click();
	const context = row.getByTestId("custom-endpoints-context");
	await expect(context).toBeEnabled();
	await expect(context).toHaveAttribute("placeholder", "Detected");
	await context.fill("12");
	await expect(row.getByTestId("custom-endpoints-context-error")).toBeVisible();
	await context.press("Escape");
	await expect(dialog).toBeVisible();
	await expect(context).toHaveValue("");
	await context.fill("262144");
	await context.press("Enter");
	const userWindow = () =>
		JSON.parse(readFileSync(modelsPath, "utf8")).providers[providerId].modelOverrides?.[MODEL]
			?.contextWindow;
	await expect.poll(userWindow).toBe(262_144);
	await dialog.getByTestId("custom-endpoints-detect").click();
	await expect(dialog.getByTestId("custom-endpoints-status")).toHaveAttribute("data-tone", "ok");
	await expect(context).toHaveValue("262144");
	await expect(
		dialog
			.locator(`[data-testid="custom-endpoints-row"][data-model="${UNREPORTED}"]`)
			.getByTestId("custom-endpoints-use"),
	).toHaveAttribute("aria-checked", "false");
	await expect(unreported.getByTestId("custom-endpoints-context")).toBeDisabled();
	await shot(dialog, "providers-settings", "custom-endpoint-context-window");
	await dialog.getByTestId("custom-endpoints-name").fill("Gateway");
	await dialog.getByTestId("custom-endpoints-save").click();
	await expect(dialog).toHaveCount(0);
	await expect(endpoint).toContainText("Gateway");
	expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers[providerId]).toMatchObject({
		name: "Gateway",
		apiKey: KEY,
		models: [{ id: MODEL, contextWindow: 65_536, maxTokens: 100_000 }],
		modelOverrides: { [MODEL]: { contextWindow: 262_144 } },
	});
	const contextWire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await expect
			.poll(
				async () =>
					(await contextWire.request("model.list", {})).find(
						(model) => model.provider === providerId && model.id === MODEL,
					)?.contextWindow,
			)
			.toBe(262_144);
	} finally {
		contextWire.close();
	}

	await endpoint.getByTestId("custom-endpoints-edit").click();
	await expect(context).toHaveValue("262144");
	await row.getByTestId("custom-endpoints-context-reset").click();
	await expect.poll(userWindow).toBeUndefined();
	await expect(context).toHaveValue("");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toHaveCount(0);

	const external = JSON.parse(readFileSync(modelsPath, "utf8"));
	external.providers[providerId].name = "Renamed outside the app";
	writeFileSync(modelsPath, JSON.stringify(external));
	await page.getByTestId("providers-refresh").click();
	await expect(endpoint).toContainText("Renamed outside the app");

	await endpoint.getByTestId("custom-endpoints-remove").click();
	await expect(page.getByTestId("confirm-dialog")).toContainText("Renamed outside the app");
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(endpoint).toHaveCount(1);

	await endpoint.focus();
	await page.keyboard.press("Delete");
	await page.getByTestId("custom-endpoints-remove-confirm").click();
	await expect(endpoint).toHaveCount(0);
	await expect(group.getByTestId("custom-endpoints-empty")).toBeVisible();
	expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers).toEqual({});
});
