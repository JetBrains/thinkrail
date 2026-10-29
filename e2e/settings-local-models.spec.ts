import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	expandModelGroup,
	openWorkspaceChat,
	revealModelGroups,
	waitForAgentSettled,
} from "./fixtures/app";
import { openProviders } from "./fixtures/jbcentral";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
const MODEL = "qwen3-coder-local";
const REPLY = "LOCAL_MODEL_REPLY_SENTINEL";
const UNREPORTED = "context-not-reported";
let server: Server;
let baseUrl: string;
const chatRequests: Record<string, unknown>[] = [];

function sse(chunks: unknown[]): string {
	return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

test.beforeAll(async () => {
	server = createServer((request, response) => {
		if (request.method === "GET" && request.url === "/v1/models") {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					object: "list",
					data: [
						{ id: MODEL, object: "model", max_model_len: 65_536 },
						{ id: UNREPORTED, object: "model" },
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
				const parsed = JSON.parse(body);
				chatRequests.push(parsed);
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
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("The fake server has no port.");
	baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a local vLLM server is detected, saved to models.json, edited, chatted with, and removed", async ({
	page,
}) => {
	writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
	await openWorkspaceChat(page);
	await openProviders(page);
	const group = page.getByTestId("settings-local-models");
	await expect(group).toBeVisible();

	await group.getByTestId("local-models-add").click();
	const dialog = page.getByTestId("local-models-dialog");
	await dialog.getByTestId("local-models-kind-vllm").click();
	await dialog.getByTestId("local-models-url").fill(baseUrl);
	await dialog.getByTestId("local-models-detect").click();
	const row = dialog.locator(`[data-testid="local-models-row"][data-model="${MODEL}"]`);
	await expect(row).toBeVisible();
	await expect(row.getByTestId("local-models-context")).toHaveValue("65536");
	await expect(row.getByTestId("local-models-output")).toHaveValue("16384");
	const unreported = dialog.locator(`[data-testid="local-models-row"][data-model="${UNREPORTED}"]`);
	await expect(unreported.getByTestId("local-models-context")).toHaveValue("32768");
	await expect(dialog.getByTestId("local-models-context-guessed")).toBeVisible();
	await dialog.getByTestId("local-models-detect").click();
	await expect(dialog.getByTestId("local-models-detect")).toBeEnabled();
	await expect(dialog.getByTestId("local-models-context-guessed")).toBeVisible();
	await unreported.getByRole("checkbox").uncheck();
	await expect(dialog.getByTestId("local-models-context-guessed")).toHaveCount(0);
	await row.getByTestId("local-models-output").fill("8192");
	await dialog.getByTestId("local-models-detect").click();
	await expect(dialog.getByTestId("local-models-detect")).toBeEnabled();
	await expect(row.getByTestId("local-models-output")).toHaveValue("8192");
	await dialog.getByTestId("local-models-save").click();
	await expect(dialog).toHaveCount(0);

	const endpoint = group.locator(
		'[data-testid="local-models-endpoint"][data-endpoint="local-vllm"]',
	);
	await expect(endpoint).toContainText(`${baseUrl}/v1`);
	await expect(
		endpoint.locator(`[data-testid="local-models-model"][data-model="${MODEL}"]`),
	).toBeVisible();

	await endpoint.getByTestId("local-models-edit").click();
	await expect(dialog.getByTestId("local-models-url")).toHaveValue(`${baseUrl}/v1`);
	await expect(
		dialog.locator(
			`[data-testid="local-models-row"][data-model="${MODEL}"] [data-testid="local-models-output"]`,
		),
	).toHaveValue("8192");
	await dialog.getByTestId("local-models-save").click();
	await expect(dialog).toHaveCount(0);
	const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
	expect(saved.providers["local-vllm"]).toMatchObject({
		api: "openai-completions",
		baseUrl: `${baseUrl}/v1`,
		models: [{ id: MODEL, contextWindow: 65_536, maxTokens: 8_192 }],
	});

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await expect
			.poll(async () =>
				(await wire.request("model.list", {})).some(
					(model) => model.provider === "local-vllm" && model.id === MODEL,
				),
			)
			.toBe(true);
	} finally {
		wire.close();
	}

	await page.keyboard.press("Escape");
	await page.getByTestId("model-selector").last().click();
	await revealModelGroups(page);
	await expandModelGroup(page, "local-vllm");
	await page
		.locator(`[data-testid="model-option"][data-provider="local-vllm"][data-model-id="${MODEL}"]`)
		.click();
	await page.getByTestId("chat-input").fill("Say hello");
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(REPLY);
	expect(chatRequests.at(-1)).toMatchObject({ model: MODEL, stream: true });
	expect(chatRequests.at(-1)).not.toHaveProperty("store");

	await openProviders(page);
	await endpoint.getByTestId("local-models-remove").click();
	await page.getByTestId("local-models-remove-confirm").click();
	await expect(endpoint).toHaveCount(0);
	expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers).toEqual({});
});
