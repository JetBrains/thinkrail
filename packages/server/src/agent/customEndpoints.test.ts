import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
		reasoning: null,
		vision: null,
		tools: null,
		...patch,
	};
}

function providers(): Record<string, Record<string, unknown>> {
	return parse(readFileSync(path, "utf8")).providers ?? {};
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
		models: [
			model("qwen3:14b", { contextWindow: 40_960, reasoning: true, vision: false, tools: true }),
		],
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
	server?.stop(true);

	const gateway = serve({
		"GET /v1/models": () => ({
			data: [{ id: "text-only", architecture: { input_modalities: ["text"] } }],
		}),
	});
	expect(await probeCustomEndpoint({ baseUrl: `${gateway.url}/v1` })).toMatchObject({
		models: [model("text-only", { vision: false })],
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
			model("reported-output", { contextWindow: 200_000, maxTokens: 32_000, reasoning: true }),
			model("unknown", { vision: false }),
		],
	});
	expect(published).toBe(1);
	expect(readFileSync(path, "utf8")).toContain("// mine");
	const id = endpoints[0]?.id ?? "";
	expect(id).toMatch(/^custom-company-gateway-[0-9a-f]{6}$/);
	const provider = providers()[id];
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
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131_072,
				maxTokens: defaultMaxTokens(131_072),
			},
			expect.objectContaining({
				id: "reported-output",
				contextWindow: 200_000,
				maxTokens: 32_000,
				reasoning: true,
			}),
			{
				id: "unknown",
				name: "unknown",
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				input: ["text"],
			},
		],
	});
	expect(providers().ollama).toEqual({ baseUrl: "http://x/v1" });
	expect(endpoints).toEqual([
		{
			id,
			name: "Company gateway",
			baseUrl: "https://llm.corp.example/v1",
			hasApiKey: true,
			models: [
				model("known", { contextWindow: 131_072, maxTokens: defaultMaxTokens(131_072) }),
				model("reported-output", { contextWindow: 200_000, maxTokens: 32_000, reasoning: true }),
				model("unknown", { vision: false }),
			],
		},
	]);
	expect(await listCustomEndpoints()).toEqual(endpoints);
});

test("saved endpoints become available pi models, and a keyless one gets pi's placeholder", async () => {
	const pi = await runtime();
	const [saved] = await saveCustomEndpoint({
		name: "Ollama",
		baseUrl: "http://127.0.0.1:11434/v1",
		models: [model("qwen3:14b", { contextWindow: 40_960 })],
	});
	const id = saved?.id ?? "";
	expect(providers()[id]?.apiKey).toBe("thinkrail-no-key");
	const available = settledAvailableModels(pi).find((m) => m.provider === id);
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
					authHeader: true,
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
	const saved = providers()["custom-gw"];
	expect(saved).toMatchObject({
		name: "Gateway",
		apiKey: "sk-saved",
		authHeader: true,
		compat: { supportsStore: false },
		modelOverrides: { a: { name: "Alias" } },
	});
	expect(saved?.models).toEqual([expect.objectContaining({ id: "a", temperature: 0.2 })]);

	await saveCustomEndpoint({
		id: "custom-gw",
		name: "Gateway",
		baseUrl: "https://gw.example/v1",
		apiKey: "",
		models: [model("a")],
	});
	expect(providers()["custom-gw"]?.apiKey).toBe("thinkrail-no-key");
});

test("an edit never moves a server to another origin, whatever its key or headers", async () => {
	await runtime();
	const seed = (extra: Record<string, unknown>) =>
		writeFileSync(
			path,
			JSON.stringify({
				providers: {
					"custom-gw": {
						baseUrl: "https://gw.example/v1",
						api: "openai-completions",
						apiKey: "sk-saved",
						models: [{ id: "a" }],
						...extra,
					},
				},
			}),
		);
	const save = (baseUrl: string, apiKey?: string) =>
		saveCustomEndpoint({
			id: "custom-gw",
			name: "GW",
			baseUrl,
			...(apiKey === undefined ? {} : { apiKey }),
			models: [model("a")],
		});
	seed({ headers: { Authorization: "Bearer old-secret" } });
	for (const apiKey of [undefined, "sk-new", ""])
		await expect(save("https://elsewhere.example/v1", apiKey)).rejects.toThrow("keeps its address");
	expect(providers()["custom-gw"]?.baseUrl).toBe("https://gw.example/v1");
	await save("https://gw.example/openai/v1");
	expect(providers()["custom-gw"]).toMatchObject({
		baseUrl: "https://gw.example/openai/v1",
		apiKey: "sk-saved",
		headers: { Authorization: "Bearer old-secret" },
	});
});

test("a server whose models route to another origin is left to models.json", async () => {
	await runtime();
	for (const extra of [
		{ models: [{ id: "a", baseUrl: "https://other.example/v1" }] },
		{ models: [{ id: "a" }], modelOverrides: { a: { baseUrl: "https://other.example/v1" } } },
	]) {
		writeFileSync(
			path,
			JSON.stringify({
				providers: {
					"custom-gw": {
						baseUrl: "https://gw.example/v1",
						api: "openai-completions",
						apiKey: "sk-saved",
						...extra,
					},
				},
			}),
		);
		await expect(
			saveCustomEndpoint({
				id: "custom-gw",
				name: "GW",
				baseUrl: "https://gw.example/v1",
				apiKey: "sk-new",
				models: [model("a")],
			}),
		).rejects.toThrow("routed to another address");
		expect(providers()["custom-gw"]?.apiKey).toBe("sk-saved");
	}
});

test("a saved address carrying credentials or a query is never listed", async () => {
	await runtime();
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"custom-query": {
					baseUrl: "https://gw.example/v1?api_key=secret",
					api: "openai-completions",
					models: [{ id: "a" }],
				},
				"custom-userinfo": {
					baseUrl: "https://user:secret@gw.example/v1",
					api: "openai-completions",
					models: [{ id: "a" }],
				},
			},
		}),
	);
	expect(await listCustomEndpoints()).toEqual([]);
	expect(await removeCustomEndpoint("custom-query")).toEqual([]);
	expect(providers()["custom-query"]).toBeDefined();
});

test("a failed /v1 fallback reports its own reason", async () => {
	const { url } = serve({
		"GET /v1/models": () => new Response("no", { status: 401 }),
	});
	expect(await probeCustomEndpoint({ baseUrl: url, apiKey: "wrong" })).toEqual({
		ok: false,
		reason: "unauthorized",
		status: 401,
	});
	server?.stop(true);
	const { url: missing } = serve({});
	expect(await probeCustomEndpoint({ baseUrl: missing })).toEqual({
		ok: false,
		reason: "not-openai",
		status: 404,
	});
});

test("a name with no Latin letters takes its id from the server's host", async () => {
	await runtime();
	const [endpoint] = await saveCustomEndpoint({
		name: "Корпоративный шлюз",
		baseUrl: "https://llm.corp.example/v1",
		models: [model("m")],
	});
	expect(endpoint?.id).toMatch(/^custom-llm-corp-example-[0-9a-f]{6}$/);
	expect(endpoint?.name).toBe("Корпоративный шлюз");
});

test("a removed server's id is never handed to the next one, so an open chat can't reach the new server's key", async () => {
	await runtime();
	const draft = { name: "Gateway", baseUrl: "https://a.example/v1", models: [model("m")] };
	const [first] = await saveCustomEndpoint(draft);
	await removeCustomEndpoint(first?.id ?? "");
	const [second] = await saveCustomEndpoint({
		...draft,
		baseUrl: "https://b.example/v1",
		apiKey: "sk-b",
	});
	expect(first?.id).toMatch(/^custom-gateway-[0-9a-f]{6}$/);
	expect(second?.id).toMatch(/^custom-gateway-[0-9a-f]{6}$/);
	expect(second?.id).not.toBe(first?.id);
});

test("a re-detected smaller context never keeps an output budget that no longer fits", async () => {
	await runtime();
	const [saved] = await saveCustomEndpoint({
		name: "vLLM",
		baseUrl: "http://gpu:8000/v1",
		models: [model("m", { contextWindow: 4_096, maxTokens: 16_384 })],
	});
	expect(providers()[saved?.id ?? ""]?.models).toEqual([
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
	expect(providers()["my-litellm"]).toEqual(handWritten);
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

test("Detect reads the saved key from the file it checks the address against", async () => {
	await runtime();
	const first = serve({ "GET /v1/models": () => ({ data: [{ id: "m" }] }) });
	const firstUrl = first.url;
	const firstSeen = first.seen;
	const firstServer = server;
	const second = serve({ "GET /v1/models": () => ({ data: [{ id: "m" }] }) });
	const endpoint = (baseUrl: string, apiKey: string) =>
		writeFileSync(
			path,
			JSON.stringify({
				providers: {
					"custom-gw": { baseUrl, api: "openai-completions", apiKey, models: [{ id: "m" }] },
				},
			}),
		);
	try {
		endpoint(`${firstUrl}/v1`, "sk-first");
		await runtime();
		endpoint(`${second.url}/v1`, "sk-second");
		await probeCustomEndpoint({ baseUrl: `${second.url}/v1`, endpointId: "custom-gw" });
		expect(second.seen.length).toBeGreaterThan(0);
		expect(second.seen.every((line) => line.endsWith("Bearer sk-second"))).toBe(true);
		expect(firstSeen).toEqual([]);
	} finally {
		firstServer?.stop(true);
	}
});

test("Detect never runs a saved command-backed key", async () => {
	await runtime();
	const marker = join(directory, "command-ran");
	const { url, seen } = serve({ "GET /v1/models": () => ({ data: [{ id: "m" }] }) });
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"custom-gw": {
					baseUrl: `${url}/v1`,
					api: "openai-completions",
					apiKey: `!touch ${marker} && echo leaked`,
					models: [{ id: "m" }],
				},
			},
		}),
	);
	expect(
		await probeCustomEndpoint({ baseUrl: `${url}/v1`, endpointId: "custom-gw" }),
	).toMatchObject({ ok: true });
	expect(existsSync(marker)).toBe(false);
	expect(seen.every((line) => line.endsWith(" -"))).toBe(true);
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
