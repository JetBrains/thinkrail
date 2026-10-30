import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { CustomEndpointModel } from "@thinkrail/contracts";
import { parse } from "jsonc-parser";
import {
	defaultMaxTokens,
	listCustomEndpoints,
	parseBaseUrl,
	parseModelList,
	probeCustomEndpoint,
	removeCustomEndpoint,
	resolveProbeKey,
	saveCustomEndpoint,
} from "./customEndpoints";
import { setModelsFilePublisher } from "./modelsFile";
import { configurePiRuntime, settledAvailableModels } from "./piRuntime";

let directory: string;
let path: string;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-custom-endpoints-"));
	path = join(directory, "models.json");
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = directory;
	process.env.PI_OFFLINE = "1";
});

afterEach(() => {
	server?.stop(true);
	server = undefined;
	setModelsFilePublisher(null);
	configurePiRuntime(null);
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(directory, { recursive: true, force: true });
});

async function runtime() {
	const result = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		allowModelNetwork: false,
	});
	await result.refresh({ allowNetwork: false });
	configurePiRuntime(result);
	return result;
}

type Route = (request: Request) => unknown;

function serve(routes: Record<string, Route>, auth?: string) {
	const seen: string[] = [];
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const key = `${request.method} ${new URL(request.url).pathname}`;
			seen.push(`${key} ${request.headers.get("authorization") ?? "-"}`);
			if (auth && request.headers.get("authorization") !== `Bearer ${auth}`)
				return new Response("no", { status: 401 });
			const route = routes[key];
			if (!route) return new Response("missing", { status: 404 });
			const body = await route(request);
			return body instanceof Response ? body : Response.json(body);
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, seen };
}

function model(id: string, patch: Partial<CustomEndpointModel> = {}): CustomEndpointModel {
	return {
		id,
		contextWindow: null,
		maxTokens: null,
		reasoning: false,
		vision: false,
		tools: null,
		...patch,
	};
}

function config(): Record<string, Record<string, Record<string, unknown>>> {
	return parse(readFileSync(path, "utf8"));
}

test("base URLs drop endpoint suffixes and refuse credentials, queries and other schemes", () => {
	expect(parseBaseUrl(" http://gpu:8000/v1/models/ ")).toBe("http://gpu:8000/v1");
	expect(parseBaseUrl("http://localhost:11434/v1/chat/completions")).toBe(
		"http://localhost:11434/v1",
	);
	expect(parseBaseUrl("https://llm.corp.example/openai")).toBe("https://llm.corp.example/openai");
	expect(parseBaseUrl("localhost:8000")).toBeNull();
	expect(parseBaseUrl("file:///etc/passwd")).toBeNull();
	expect(parseBaseUrl("https://user:secret@llm.corp.example/v1")).toBeNull();
	expect(parseBaseUrl("https://llm.corp.example/v1?key=secret")).toBeNull();
});

test("probe keys resolve a whole $VAR reference and never run commands", () => {
	process.env.THINKRAIL_TEST_KEY = "from-env";
	try {
		expect(resolveProbeKey("$THINKRAIL_TEST_KEY")).toBe("from-env");
		expect(resolveProbeKey(["$", "{THINKRAIL_TEST_KEY}"].join(""))).toBe("from-env");
		expect(resolveProbeKey("$THINKRAIL_TEST_MISSING")).toBeUndefined();
		expect(resolveProbeKey("!cat secret")).toBeUndefined();
		expect(resolveProbeKey("  ")).toBeUndefined();
		expect(resolveProbeKey(" sk-literal ")).toBe("sk-literal");
	} finally {
		delete process.env.THINKRAIL_TEST_KEY;
	}
});

test("model listings read every reported limit, skip non-chat models and reject non-lists", () => {
	expect(
		parseModelList({
			data: [
				{ id: "vllm", max_model_len: 65_536 },
				{ id: "litellm", max_input_tokens: 128_000, max_output_tokens: 8_192, mode: "chat" },
				{ id: "router", context_length: 200_000, architecture: { input_modalities: ["image"] } },
				{ id: "llama", meta: { n_ctx: 32_768, n_ctx_train: 131_072 } },
				{ id: "bare" },
				{ id: "bare" },
				{ id: "embed", mode: "embedding" },
				{ id: "painter", architecture: { output_modalities: ["image"] } },
				{ id: "" },
			],
		}),
	).toEqual([
		model("vllm", { contextWindow: 65_536 }),
		model("litellm", { contextWindow: 128_000, maxTokens: 8_192 }),
		model("router", { contextWindow: 200_000, vision: true }),
		model("llama", { contextWindow: 32_768 }),
		model("bare"),
	]);
	expect(parseModelList({ models: [] })).toBeNull();
	expect(parseModelList("nope")).toBeNull();
});

test("a gateway probe sends the typed key, retries /v1 and leaves unreported facts null", async () => {
	const { url, seen } = serve(
		{ "GET /v1/models": () => ({ object: "list", data: [{ id: "qwen3-coder" }] }) },
		"sk-gateway",
	);
	const probe = await probeCustomEndpoint({ baseUrl: url, apiKey: "sk-gateway" });
	expect(probe).toEqual({ ok: true, baseUrl: `${url}/v1`, models: [model("qwen3-coder")] });
	expect(seen.every((line) => line.endsWith("Bearer sk-gateway"))).toBe(true);
	expect(await probeCustomEndpoint({ baseUrl: url, apiKey: "wrong" })).toEqual({
		ok: false,
		reason: "unauthorized",
		status: 401,
	});
});

test("probe failures come back as closed reasons", async () => {
	expect(await probeCustomEndpoint({ baseUrl: "localhost" })).toEqual({
		ok: false,
		reason: "invalid-url",
	});
	const { url } = serve({
		"GET /empty/models": () => ({ data: [] }),
		"GET /html/models": () => new Response("<html>", { status: 200 }),
		"GET /down/models": () => new Response("busy", { status: 503 }),
	});
	expect(await probeCustomEndpoint({ baseUrl: `${url}/empty` })).toEqual({
		ok: false,
		reason: "no-models",
	});
	expect(await probeCustomEndpoint({ baseUrl: `${url}/html` })).toEqual({
		ok: false,
		reason: "not-openai",
	});
	expect(await probeCustomEndpoint({ baseUrl: `${url}/down` })).toEqual({
		ok: false,
		reason: "not-openai",
		status: 503,
	});
	server?.stop(true);
	expect(await probeCustomEndpoint({ baseUrl: `${url}/v1` })).toMatchObject({
		ok: false,
		reason: "unreachable",
	});
});

test("probes fill facts from Ollama, llama.cpp and LM Studio without a server kind", async () => {
	const ollama = serve({
		"GET /v1/models": () => ({ data: [{ id: "qwen3:14b" }, { id: "nomic-embed" }] }),
		"GET /api/version": () => ({ version: "0.12.0" }),
		"POST /api/show": async (request) => {
			const { model: id } = (await request.json()) as { model: string };
			return id === "nomic-embed"
				? { capabilities: ["embedding"] }
				: { capabilities: ["completion", "tools", "thinking"], parameters: "num_ctx 40960" };
		},
	});
	expect(await probeCustomEndpoint({ baseUrl: `${ollama.url}/v1` })).toEqual({
		ok: true,
		baseUrl: `${ollama.url}/v1`,
		models: [model("qwen3:14b", { contextWindow: 40_960, reasoning: true, tools: true })],
	});
	server?.stop(true);

	const llama = serve({
		"GET /v1/models": () => ({ data: [{ id: "gemma", meta: { n_ctx_train: 131_072 } }] }),
		"GET /props": () => ({
			default_generation_settings: { n_ctx: 8_192 },
			chat_template: "{% if enable_thinking %}",
			chat_template_caps: { supports_tools: false },
		}),
	});
	expect(await probeCustomEndpoint({ baseUrl: `${llama.url}/v1` })).toMatchObject({
		models: [model("gemma", { contextWindow: 8_192, reasoning: true, tools: false })],
	});
	server?.stop(true);

	const lmStudio = serve({
		"GET /v1/models": () => ({ data: [{ id: "qwen-vl" }, { id: "embedder" }] }),
		"GET /api/v0/models": () => ({
			data: [
				{ id: "qwen-vl", type: "vlm", loaded_context_length: 16_384, capabilities: ["tool_use"] },
				{ id: "embedder", type: "embeddings" },
			],
		}),
	});
	expect(await probeCustomEndpoint({ baseUrl: `${lmStudio.url}/v1` })).toMatchObject({
		models: [model("qwen-vl", { contextWindow: 16_384, vision: true, tools: true })],
	});
});

test("save writes only reported facts with derived output and conservative compat", async () => {
	await runtime();
	let published = 0;
	setModelsFilePublisher(() => published++);
	writeFileSync(
		path,
		'{\n  // mine\n  "providers": { "ollama": { "baseUrl": "http://x/v1" } }\n}\n',
	);
	const endpoints = await saveCustomEndpoint({
		name: "Company gateway",
		baseUrl: "https://llm.corp.example/v1/",
		apiKey: "$CORP_KEY",
		models: [
			model("known", { contextWindow: 131_072, tools: true }),
			model("reported-output", { contextWindow: 200_000, maxTokens: 32_000 }),
			model("unknown"),
		],
	});
	expect(published).toBe(1);
	expect(readFileSync(path, "utf8")).toContain("// mine");
	const provider = config().providers["custom-company-gateway"];
	expect(provider).toEqual({
		name: "Company gateway",
		baseUrl: "https://llm.corp.example/v1",
		api: "openai-completions",
		apiKey: "$CORP_KEY",
		compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" },
		models: [
			{
				id: "known",
				name: "known",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131_072,
				maxTokens: defaultMaxTokens(131_072),
			},
			expect.objectContaining({ id: "reported-output", contextWindow: 200_000, maxTokens: 32_000 }),
			expect.not.objectContaining({ contextWindow: expect.anything() }),
		],
	});
	expect(config().providers.ollama).toEqual({ baseUrl: "http://x/v1" });
	expect(endpoints).toEqual([
		{
			id: "custom-company-gateway",
			name: "Company gateway",
			baseUrl: "https://llm.corp.example/v1",
			hasApiKey: true,
			models: [
				model("known", { contextWindow: 131_072, maxTokens: defaultMaxTokens(131_072) }),
				model("reported-output", { contextWindow: 200_000, maxTokens: 32_000 }),
				model("unknown"),
			],
		},
	]);
	expect(await listCustomEndpoints()).toEqual(endpoints);
});

test("saved endpoints become available pi models, and a keyless one gets pi's placeholder", async () => {
	const pi = await runtime();
	await saveCustomEndpoint({
		name: "Ollama",
		baseUrl: "http://127.0.0.1:11434/v1",
		models: [model("qwen3:14b", { contextWindow: 40_960 })],
	});
	expect(config().providers["custom-ollama"]?.apiKey).toBe("thinkrail-no-key");
	const available = settledAvailableModels(pi).find((m) => m.provider === "custom-ollama");
	expect(available).toMatchObject({ id: "qwen3:14b", contextWindow: 40_960 });
	expect((await listCustomEndpoints())[0]?.hasApiKey).toBe(false);
});

test("edits keep hand-added fields, clear managed overrides and guard the saved key", async () => {
	await runtime();
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"custom-gw": {
					name: "GW",
					baseUrl: "https://gw.example/v1",
					api: "openai-completions",
					apiKey: "sk-saved",
					headers: { "x-team": "core" },
					compat: { supportsStore: false },
					models: [{ id: "a", contextWindow: 8_000, maxTokens: 2_000, temperature: 0.2 }],
					modelOverrides: { a: { contextWindow: 4_000, name: "Alias" } },
				},
			},
		}),
	);
	const [listed] = await listCustomEndpoints();
	expect(listed?.models[0]).toEqual(model("a", { contextWindow: 4_000, maxTokens: 2_000 }));

	await saveCustomEndpoint({
		id: "custom-gw",
		name: "Gateway",
		baseUrl: "https://gw.example/v1",
		models: [model("a", { contextWindow: 8_000, maxTokens: 2_000 })],
	});
	const saved = config().providers["custom-gw"];
	expect(saved).toMatchObject({
		name: "Gateway",
		apiKey: "sk-saved",
		headers: { "x-team": "core" },
		compat: { supportsStore: false },
		modelOverrides: { a: { name: "Alias" } },
	});
	expect(saved?.models).toEqual([expect.objectContaining({ id: "a", temperature: 0.2 })]);

	await expect(
		saveCustomEndpoint({
			id: "custom-gw",
			name: "Gateway",
			baseUrl: "https://elsewhere.example/v1",
			models: [model("a")],
		}),
	).rejects.toThrow("The server address changed");
	await saveCustomEndpoint({
		id: "custom-gw",
		name: "Gateway",
		baseUrl: "https://elsewhere.example/v1",
		apiKey: "",
		models: [model("a")],
	});
	expect(config().providers["custom-gw"]?.apiKey).toBe("thinkrail-no-key");
});

test("a re-detected smaller context never keeps an output budget that no longer fits", async () => {
	await runtime();
	await saveCustomEndpoint({
		name: "vLLM",
		baseUrl: "http://gpu:8000/v1",
		models: [model("m", { contextWindow: 4_096, maxTokens: 16_384 })],
	});
	expect(config().providers["custom-vllm"]?.models).toEqual([
		expect.objectContaining({ contextWindow: 4_096, maxTokens: 1_024 }),
	]);
});

test("only custom-* providers are listed, edited or removed", async () => {
	await runtime();
	const handWritten = {
		baseUrl: "http://10.0.4.12:4000",
		api: "openai-completions",
		apiKey: "sk-hand",
		models: [{ id: "x" }],
	};
	writeFileSync(path, JSON.stringify({ providers: { "my-litellm": handWritten } }));
	expect(await listCustomEndpoints()).toEqual([]);
	await expect(
		saveCustomEndpoint({
			id: "my-litellm",
			name: "x",
			baseUrl: "http://a/v1",
			models: [model("x")],
		}),
	).rejects.toThrow("no longer in models.json");
	expect(await removeCustomEndpoint("my-litellm")).toEqual([]);
	expect(config().providers["my-litellm"]).toEqual(handWritten);
});

test("Detect reuses a saved key only for that endpoint's unchanged address", async () => {
	await runtime();
	const { url, seen } = serve({ "GET /v1/models": () => ({ data: [{ id: "m" }] }) }, "sk-saved");
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"custom-gw": {
					baseUrl: `${url}/v1`,
					api: "openai-completions",
					apiKey: "sk-saved",
					models: [{ id: "m" }],
				},
			},
		}),
	);
	await runtime();
	expect(
		await probeCustomEndpoint({ baseUrl: `${url}/v1`, endpointId: "custom-gw" }),
	).toMatchObject({
		ok: true,
	});
	const other = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			seen.push(`other ${request.headers.get("authorization") ?? "-"}`);
			return Response.json({ data: [{ id: "m" }] });
		},
	});
	try {
		await probeCustomEndpoint({
			baseUrl: `http://127.0.0.1:${other.port}/v1`,
			endpointId: "custom-gw",
		});
	} finally {
		other.stop(true);
	}
	const otherRequests = seen.filter((line) => line.startsWith("other"));
	expect(otherRequests.length).toBeGreaterThan(0);
	expect(otherRequests.every((line) => line === "other -")).toBe(true);
});

test("invalid drafts are refused before models.json is touched", async () => {
	await runtime();
	const bad = [
		{ name: " ", baseUrl: "http://a/v1", models: [model("m")] },
		{ name: "a", baseUrl: "ftp://a", models: [model("m")] },
		{ name: "a", baseUrl: "http://a/v1", models: [] },
		{ name: "a", baseUrl: "http://a/v1", models: [model("m"), model("m")] },
		{ name: "a", baseUrl: "http://a/v1", models: [model("m", { contextWindow: -1 })] },
	];
	for (const draft of bad) await expect(saveCustomEndpoint(draft)).rejects.toThrow();
	expect(() => readFileSync(path)).toThrow();
});
