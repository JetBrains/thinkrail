import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { parse } from "jsonc-parser";
import {
	createSession,
	disableSessionServerFallback,
	disposeAllSessions,
	promptSession,
	setSessionManagerFactory,
	toWireModel,
} from "./agentSessionManager";
import { setModelsFilePublisher } from "./modelsFile";
import { configurePiRuntime } from "./piRuntime";
import { declaresServerFallback, disableProviderFallback } from "./serverFallback";

const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"THINKRAIL_DATA_DIR",
	"PI_OFFLINE",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_OAUTH_TOKEN",
] as const;

let agentDir: string;
let dataDir: string;
let cwd: string;
let path: string;
let published: number;
const prior = new Map<string, string | undefined>();

beforeEach(() => {
	for (const key of ENV_KEYS) prior.set(key, process.env[key]);
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.ANTHROPIC_OAUTH_TOKEN;
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-fallback-agent-"));
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-fallback-data-"));
	cwd = mkdtempSync(join(tmpdir(), "thinkrail-fallback-cwd-"));
	path = join(agentDir, "models.json");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_OFFLINE = "1";
	published = 0;
	setModelsFilePublisher(() => {
		published++;
	});
	setSessionManagerFactory(() => SessionManager.inMemory(cwd));
});

afterEach(() => {
	disposeAllSessions();
	configurePiRuntime(null);
	setModelsFilePublisher(null);
	setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
	for (const [key, value] of prior) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of [agentDir, dataDir, cwd]) rmSync(dir, { recursive: true, force: true });
});

async function anthropicRuntime(): Promise<ModelRuntime> {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => ({
		type: "api_key",
		key: "fixture-only-key",
	}));
	const runtime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	await runtime.refresh({ allowNetwork: false });
	configurePiRuntime(runtime);
	return runtime;
}

function fallbackModel(runtime: ModelRuntime): Model<string> {
	const model = runtime.getModels("anthropic").find(declaresServerFallback);
	if (!model) throw new Error("pi ships no Anthropic model with server-side fallback");
	return model;
}

function config(): unknown {
	return parse(readFileSync(path, "utf8"), [], { allowTrailingComma: true });
}

describe("disableProviderFallback", () => {
	test("writes provider compat once, keeps comments, refreshes each runtime and notifies on change", async () => {
		writeFileSync(
			path,
			'{ // keep this note\n  "providers": {\n    "anthropic": { "baseUrl": "http://proxy.invalid" },\n  },\n}\n',
		);
		let refreshes = 0;
		const runtime = {
			refresh: async () => {
				refreshes++;
			},
		};
		await disableProviderFallback("anthropic", [runtime, runtime]);
		expect(readFileSync(path, "utf8")).toContain("// keep this note");
		expect(config()).toEqual({
			providers: {
				anthropic: { baseUrl: "http://proxy.invalid", compat: { allowedFallbackModels: [] } },
			},
		});
		expect(refreshes).toBe(1);
		expect(published).toBe(1);
		await disableProviderFallback("anthropic", [runtime]);
		expect(refreshes).toBe(2);
		expect(published).toBe(1);
	});

	test("refuses a models.json that isn't valid JSON and leaves it untouched", async () => {
		writeFileSync(path, "{ not json");
		await expect(disableProviderFallback("anthropic", [])).rejects.toThrow("isn't valid JSON");
		expect(readFileSync(path, "utf8")).toBe("{ not json");
	});
});

describe("disableSessionServerFallback", () => {
	test("turns fallback off for every provider model and updates the open chat's model", async () => {
		const runtime = await anthropicRuntime();
		const fable = fallbackModel(runtime);
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: toWireModel(fable),
		});

		const model = await disableSessionServerFallback(sessionId);

		expect(model).toMatchObject({ provider: "anthropic", id: fable.id });
		expect(config()).toEqual({
			providers: { anthropic: { compat: { allowedFallbackModels: [] } } },
		});
		expect(runtime.getModels("anthropic").filter(declaresServerFallback)).toEqual([]);
		expect(published).toBe(1);
	});

	test("the open chat's next request carries neither fallbacks nor the fallback beta", async () => {
		const requests: { body: Record<string, unknown>; beta: string }[] = [];
		const proxy = Bun.serve({
			port: 0,
			async fetch(request) {
				requests.push({
					body: (await request.json()) as Record<string, unknown>,
					beta: request.headers.get("anthropic-beta") ?? "",
				});
				return Response.json(
					{
						type: "error",
						error: {
							type: "invalid_request_error",
							message: "Anthropic proxy does not support fallback field",
						},
					},
					{ status: 400 },
				);
			},
		});
		try {
			writeFileSync(
				path,
				JSON.stringify({ providers: { anthropic: { baseUrl: `http://127.0.0.1:${proxy.port}` } } }),
			);
			const runtime = await anthropicRuntime();
			const fable = fallbackModel(runtime);
			const { sessionId } = await createSession({
				cwd,
				workspaceId: "ws",
				model: toWireModel(fable),
			});
			await promptSession(sessionId, "hello");
			expect(requests.at(-1)?.body).toHaveProperty("fallbacks");
			expect(requests.at(-1)?.beta).toContain("server-side-fallback");

			await disableSessionServerFallback(sessionId);
			await promptSession(sessionId, "Try again.");

			expect(requests.at(-1)?.body).not.toHaveProperty("fallbacks");
			expect(requests.at(-1)?.beta).not.toContain("server-side-fallback");
		} finally {
			proxy.stop(true);
		}
	});

	test("refuses a chat whose model sends no fallbacks without touching models.json", async () => {
		const runtime = await anthropicRuntime();
		const plain = runtime.getModels("anthropic").find((model) => !declaresServerFallback(model));
		if (!plain) throw new Error("pi ships no Anthropic model without fallbacks");
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: toWireModel(plain),
		});

		await expect(disableSessionServerFallback(sessionId)).rejects.toMatchObject({
			code: "SERVER_FALLBACK_NOT_USED",
		});
		expect(() => readFileSync(path, "utf8")).toThrow();
	});

	test("reports a per-model override that still sends fallbacks", async () => {
		const id = fallbackModel(await anthropicRuntime()).id;
		writeFileSync(
			path,
			JSON.stringify({
				providers: {
					anthropic: {
						modelOverrides: {
							[id]: {
								compat: {
									allowedFallbackModels: [{ provider: "anthropic", model: "claude-opus-5" }],
								},
							},
						},
					},
				},
			}),
		);
		const runtime = await anthropicRuntime();
		const fable = fallbackModel(runtime);
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: toWireModel(fable),
		});

		await expect(disableSessionServerFallback(sessionId)).rejects.toMatchObject({
			code: "SERVER_FALLBACK_STILL_ON",
		});
	});
});
