import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { parse } from "jsonc-parser";
import {
	listLocalEndpoints,
	normalizeLocalBaseUrl,
	parseModelList,
	probeLocalModels,
	removeLocalEndpoint,
	resolveProbeKey,
	saveLocalEndpoint,
} from "./localModels";
import { setModelsFilePublisher } from "./modelsFile";
import { configurePiRuntime, settledAvailableModels } from "./piRuntime";

let directory: string;
let path: string;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-local-models-"));
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

function serve(routes: Record<string, (request: Request) => unknown>, auth?: string) {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			if (auth && request.headers.get("authorization") !== `Bearer ${auth}`)
				return new Response("no", { status: 401 });
			const route = routes[`${request.method} ${new URL(request.url).pathname}`];
			if (!route) return new Response("missing", { status: 404 });
			return Response.json(await route(request));
		},
	});
	return `http://127.0.0.1:${server.port}`;
}

test("base URLs gain /v1 for known servers and lose endpoint suffixes", () => {
	expect(normalizeLocalBaseUrl("llama.cpp", "http://127.0.0.1:8080")).toBe(
		"http://127.0.0.1:8080/v1",
	);
	expect(normalizeLocalBaseUrl("vllm", "http://gpu:8000/v1/models/")).toBe("http://gpu:8000/v1");
	expect(normalizeLocalBaseUrl("ollama", " http://localhost:11434/v1/chat/completions ")).toBe(
		"http://localhost:11434/v1",
	);
	expect(normalizeLocalBaseUrl("openai-compatible", "https://proxy.lan/openai")).toBe(
		"https://proxy.lan/openai",
	);
	expect(() => normalizeLocalBaseUrl("vllm", "localhost:8000")).toThrow();
	expect(() => normalizeLocalBaseUrl("vllm", "file:///etc/passwd")).toThrow();
});

test("probe keys interpolate env references like pi and never run commands", () => {
	process.env.THINKRAIL_TEST_KEY = "from-env";
	process.env.THINKRAIL_TEST_PREFIX = "pre";
	try {
		expect(resolveProbeKey("$THINKRAIL_TEST_KEY")).toBe("from-env");
		expect(resolveProbeKey(["$", "{THINKRAIL_TEST_KEY}"].join(""))).toBe("from-env");
		expect(
			resolveProbeKey(["$", "{THINKRAIL_TEST_PREFIX}-$", "{THINKRAIL_TEST_KEY}"].join("")),
		).toBe("pre-from-env");
		expect(resolveProbeKey("a$$b$!c")).toBe("a$b!c");
		expect(resolveProbeKey("$THINKRAIL_TEST_MISSING")).toBeUndefined();
		expect(resolveProbeKey("!cat secret")).toBeUndefined();
		expect(resolveProbeKey("  ")).toBeUndefined();
		expect(resolveProbeKey("literal")).toBe("literal");
	} finally {
		delete process.env.THINKRAIL_TEST_KEY;
		delete process.env.THINKRAIL_TEST_PREFIX;
	}
});

test("model listings read vLLM and llama.cpp context hints and skip non-text models", () => {
	expect(
		parseModelList({
			data: [
				{ id: "Qwen/Qwen3-Coder-30B", max_model_len: 65_536 },
				{
					id: "gemma",
					meta: { n_ctx: 32_768, n_ctx_train: 131_072 },
					architecture: { input_modalities: ["text", "image"] },
				},
				{ id: "router-model", status: { value: "loaded", args: ["--port", "1", "-c", "16384"] } },
				{ id: "trained-only", meta: { n_ctx_train: 131_072 } },
				{ id: "judge", architecture: { output_modalities: ["decisions"] } },
				{ id: "plain" },
				{ id: "plain" },
				{ nope: true },
			],
		}),
	).toEqual([
		{
			id: "Qwen/Qwen3-Coder-30B",
			contextWindow: 65_536,
			reasoning: false,
			vision: false,
			tools: null,
		},
		{ id: "gemma", contextWindow: 32_768, reasoning: false, vision: true, tools: null },
		{ id: "router-model", contextWindow: 16_384, reasoning: false, vision: false, tools: null },
		{ id: "trained-only", contextWindow: null, reasoning: false, vision: false, tools: null },
		{ id: "plain", contextWindow: null, reasoning: false, vision: false, tools: null },
	]);
	expect(parseModelList("garbage")).toEqual([]);
});

test("a llama.cpp probe takes the per-slot context from /props over the training length", async () => {
	const base = serve(
		{
			"GET /v1/models": () => ({
				data: [{ id: "qwen3-8b", meta: { n_ctx: 32_768, n_ctx_train: 131_072 } }],
			}),
			"GET /props": () => ({
				default_generation_settings: { n_ctx: 8_192 },
				total_slots: 4,
				chat_template_caps: { supports_tools: true },
				chat_template: "{% if enable_thinking %}...",
			}),
		},
		"sekret",
	);
	expect(await probeLocalModels({ kind: "llama.cpp", baseUrl: base, apiKey: "sekret" })).toEqual({
		baseUrl: `${base}/v1`,
		models: [{ id: "qwen3-8b", contextWindow: 8_192, reasoning: true, vision: false, tools: true }],
	});
	await expect(probeLocalModels({ kind: "llama.cpp", baseUrl: base })).rejects.toThrow("HTTP 401");
});

test("an Ollama probe reads capabilities and num_ctx, never the training length", async () => {
	const base = serve({
		"GET /v1/models": () => ({ data: [{ id: "qwen3:8b" }, { id: "llama3:8b" }] }),
		"POST /api/show": async (request) => {
			const qwen = JSON.stringify(await request.json()).includes("qwen3:8b");
			return {
				model_info: { "qwen3.context_length": 131_072 },
				parameters: qwen ? 'num_ctx                        8192\nstop "<|im_end|>"' : "",
				capabilities: ["completion", "tools", "thinking"],
			};
		},
	});
	expect((await probeLocalModels({ kind: "ollama", baseUrl: base })).models).toEqual([
		{ id: "qwen3:8b", contextWindow: 8_192, reasoning: true, vision: false, tools: true },
		{ id: "llama3:8b", contextWindow: null, reasoning: true, vision: false, tools: true },
	]);
});

test("an LM Studio probe uses only the loaded context", async () => {
	const base = serve({
		"GET /v1/models": () => ({ data: [{ id: "loaded" }, { id: "idle" }] }),
		"GET /api/v0/models": () => ({
			data: [
				{ id: "loaded", type: "llm", loaded_context_length: 16_384, max_context_length: 131_072 },
				{ id: "idle", type: "llm", max_context_length: 131_072 },
			],
		}),
	});
	expect(
		(await probeLocalModels({ kind: "lmstudio", baseUrl: base })).models.map((model) => [
			model.id,
			model.contextWindow,
		]),
	).toEqual([
		["loaded", 16_384],
		["idle", null],
	]);
});

test("saving clears a model override that would shadow the saved budgets", async () => {
	await runtime();
	const draft = {
		kind: "vllm" as const,
		name: "box",
		baseUrl: "http://127.0.0.1:1/v1",
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false }],
	};
	await saveLocalEndpoint(draft);
	const config = JSON.parse(readFileSync(path, "utf8"));
	config.providers["local-box"].modelOverrides = {
		m: {
			contextWindow: 131_072,
			maxTokens: 32_768,
			reasoning: true,
			input: ["text", "image"],
			thinkingLevelMap: { off: "off" },
			compat: { thinkingFormat: "qwen-chat-template", supportsStore: false },
			name: "Mine",
		},
		other: { contextWindow: 4_096 },
	};
	writeFileSync(path, JSON.stringify(config));
	const pi = await runtime();
	expect((await listLocalEndpoints())[0]?.models[0]).toMatchObject({
		contextWindow: 131_072,
		maxTokens: 32_768,
	});
	await saveLocalEndpoint({ ...draft, id: "local-box" });
	const saved = JSON.parse(readFileSync(path, "utf8")).providers["local-box"];
	expect(saved.modelOverrides).toEqual({
		m: { compat: { supportsStore: false }, name: "Mine" },
		other: { contextWindow: 4_096 },
	});
	const model = settledAvailableModels(pi).find((m) => m.provider === "local-box" && m.id === "m");
	expect([model?.contextWindow, model?.maxTokens]).toEqual([8_192, 2_048]);
	expect((await listLocalEndpoints())[0]?.models[0]).toMatchObject({
		contextWindow: 8_192,
		maxTokens: 2_048,
	});
});

test("an unreachable server reports a short failure", async () => {
	const base = serve({});
	server?.stop(true);
	server = undefined;
	await expect(probeLocalModels({ kind: "vllm", baseUrl: base })).rejects.toThrow(
		/Couldn't list models at .*\/v1\/models/,
	);
});

test("saving writes a chat-completions provider pi serves, keeps unrelated config, and removes cleanly", async () => {
	writeFileSync(
		path,
		'\uFEFF{\n  // keep me\n  "providers": {\n    "openai": { "modelOverrides": { "gpt-5.5": { "contextWindow": 1000000 } } }\n  }\n}\n',
	);
	const pi = await runtime();
	let published = 0;
	setModelsFilePublisher(() => {
		published++;
	});

	const saved = await saveLocalEndpoint({
		kind: "vllm",
		name: "GPU box vLLM",
		baseUrl: "http://gpu.lan:8000",
		models: [
			{
				id: "Qwen/Qwen3-Coder-30B",
				contextWindow: 65_536,
				maxTokens: 16384,
				reasoning: true,
				vision: false,
			},
			{ id: "small", contextWindow: 8_192, maxTokens: 2048, reasoning: false, vision: true },
		],
	});
	expect(saved).toEqual([
		{
			id: "local-gpu-box-vllm",
			name: "GPU box vLLM",
			baseUrl: "http://gpu.lan:8000/v1",
			hasApiKey: false,
			chatTemplateThinking: true,
			models: [
				{
					id: "Qwen/Qwen3-Coder-30B",
					contextWindow: 65_536,
					maxTokens: 16384,
					reasoning: true,
					vision: false,
				},
				{ id: "small", contextWindow: 8_192, maxTokens: 2048, reasoning: false, vision: true },
			],
		},
	]);
	expect(published).toBe(1);

	const source = readFileSync(path, "utf8");
	expect(source.startsWith("\uFEFF")).toBe(true);
	expect(source).toContain("// keep me");
	const config = parse(source.slice(1), [], { allowTrailingComma: true });
	expect(config.providers.openai.modelOverrides["gpt-5.5"].contextWindow).toBe(1_000_000);
	const provider = config.providers["local-gpu-box-vllm"];
	expect(provider).toMatchObject({
		api: "openai-completions",
		compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
	});
	expect(provider.models[0]).toMatchObject({
		maxTokens: 16_384,
		compat: { thinkingFormat: "qwen-chat-template" },
	});
	expect(provider.models[1]).toMatchObject({ input: ["text", "image"], maxTokens: 2_048 });

	const available = settledAvailableModels(pi).filter((m) => m.provider === "local-gpu-box-vllm");
	expect(available.map((m) => [m.id, m.contextWindow, m.baseUrl])).toEqual([
		["Qwen/Qwen3-Coder-30B", 65_536, "http://gpu.lan:8000/v1"],
		["small", 8_192, "http://gpu.lan:8000/v1"],
	]);

	await saveLocalEndpoint({
		kind: "vllm",
		name: "GPU box vLLM",
		baseUrl: "http://gpu.lan:8000/v1",
		models: [
			{ id: "small", contextWindow: 8_192, maxTokens: 2048, reasoning: false, vision: false },
		],
	});
	expect((await listLocalEndpoints()).map((endpoint) => endpoint.id)).toEqual([
		"local-gpu-box-vllm",
		"local-gpu-box-vllm-2",
	]);

	const edited = await saveLocalEndpoint({
		id: "local-gpu-box-vllm",
		kind: "vllm",
		name: "GPU box",
		baseUrl: "http://gpu.lan:8000/v1",
		apiKey: "$VLLM_KEY",
		models: [
			{ id: "small", contextWindow: 8_192, maxTokens: 2048, reasoning: false, vision: true },
		],
	});
	expect(edited[0]).toMatchObject({
		id: "local-gpu-box-vllm",
		name: "GPU box",
		hasApiKey: true,
	});
	expect(edited[1]).toMatchObject({ id: "local-gpu-box-vllm-2" });

	await removeLocalEndpoint("local-gpu-box-vllm");
	await removeLocalEndpoint("local-gpu-box-vllm-2");
	await removeLocalEndpoint("openai");
	expect(await listLocalEndpoints()).toEqual([]);
	const after = parse(readFileSync(path, "utf8").slice(1), [], { allowTrailingComma: true });
	expect(Object.keys(after.providers)).toEqual(["openai"]);
	expect(settledAvailableModels(pi).some((m) => m.provider.startsWith("local-"))).toBe(false);
});

test("drafts are validated before anything is written", async () => {
	await runtime();
	const draft = {
		kind: "llama.cpp" as const,
		name: "x",
		baseUrl: "http://127.0.0.1:8080",
		models: [{ id: "m", contextWindow: 100, maxTokens: 1024, reasoning: false, vision: false }],
	};
	await expect(saveLocalEndpoint(draft)).rejects.toThrow("Context windows");
	await expect(saveLocalEndpoint({ ...draft, models: [] })).rejects.toThrow("at least one");
	const ok = { id: "m", contextWindow: 4096, maxTokens: 1024, reasoning: false, vision: false };
	await expect(
		saveLocalEndpoint({ ...draft, models: [{ ...ok, maxTokens: 8192 }] }),
	).rejects.toThrow("Max output");
	await expect(
		saveLocalEndpoint({
			...draft,
			id: "local-missing",
			models: [{ id: "m", contextWindow: 4096, maxTokens: 1024, reasoning: false, vision: false }],
		}),
	).rejects.toThrow("no longer");
	expect(() => statSync(path)).toThrow();
});

test("a saved key is reused only for the endpoint's own unchanged URL", async () => {
	const seen: (string | null)[] = [];
	const listing = { data: [{ id: "m" }] };
	const saved = serve({ "GET /v1/models": () => listing }, "sekret");
	const savedServer = server;
	const other = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			seen.push(request.headers.get("authorization"));
			return Response.json(listing);
		},
	});
	try {
		await runtime();
		await saveLocalEndpoint({
			kind: "vllm",
			name: "box",
			baseUrl: saved,
			apiKey: "sekret",
			models: [
				{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false },
			],
		});
		expect(
			(await probeLocalModels({ kind: "vllm", baseUrl: saved, endpointId: "local-box" })).models,
		).toHaveLength(1);
		await probeLocalModels({
			kind: "vllm",
			baseUrl: `http://127.0.0.1:${other.port}`,
			endpointId: "local-box",
		});
		await probeLocalModels({
			kind: "vllm",
			baseUrl: `http://127.0.0.1:${other.port}`,
			endpointId: "openai",
		});
		expect(seen).toEqual([null, null]);
	} finally {
		other.stop(true);
		server = savedServer;
	}
});

test("changing a thinking endpoint's kind drops the chat-template thinking settings", async () => {
	await runtime();
	const model = { id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: true, vision: false };
	const draft = {
		name: "box",
		baseUrl: "http://127.0.0.1:8080/v1",
		models: [model],
	};
	await saveLocalEndpoint({ ...draft, kind: "llama.cpp" });
	const before = parse(readFileSync(path, "utf8")).providers["local-box"].models[0];
	expect(before.compat.thinkingFormat).toBe("qwen-chat-template");
	await saveLocalEndpoint({ ...draft, id: "local-box", kind: "ollama" });
	const after = parse(readFileSync(path, "utf8")).providers["local-box"].models[0];
	expect(after.reasoning).toBe(true);
	expect(after.thinkingLevelMap).toBeUndefined();
	expect(after.compat?.thinkingFormat).toBeUndefined();
});

test("hand-written providers stay out of the list and cannot be edited or removed", async () => {
	const handWritten = {
		providers: {
			gpu: {
				baseUrl: "http://gpu:8000/openai",
				api: "openai-completions",
				apiKey: "k",
				models: [{ id: "m" }],
			},
		},
	};
	writeFileSync(path, JSON.stringify(handWritten));
	await runtime();
	expect(await listLocalEndpoints()).toEqual([]);
	await removeLocalEndpoint("gpu");
	await expect(
		saveLocalEndpoint({
			id: "gpu",
			kind: "vllm",
			name: "gpu",
			baseUrl: "http://gpu:8000/openai",
			models: [
				{ id: "m", contextWindow: 32_768, maxTokens: 8_192, reasoning: false, vision: false },
			],
		}),
	).rejects.toThrow("no longer");
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(handWritten);
});

test("URLs carrying credentials or a query string are refused", () => {
	expect(() => normalizeLocalBaseUrl("vllm", "http://user:pass@gpu:8000/v1")).toThrow(
		"API key field",
	);
	expect(() => normalizeLocalBaseUrl("vllm", "http://gpu:8000/v1?key=x")).toThrow("query string");
});

test("a saved key pi cannot resolve fails Detect without exposing the key", async () => {
	const base = serve({ "GET /v1/models": () => ({ data: [{ id: "m" }] }) });
	await runtime();
	await saveLocalEndpoint({
		kind: "vllm",
		name: "box",
		baseUrl: base,
		apiKey: "placeholder",
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false }],
	});
	const config = JSON.parse(readFileSync(path, "utf8"));
	config.providers["local-box"].apiKey = "!exit 3 # SECRET_COMMAND_SENTINEL";
	writeFileSync(path, JSON.stringify(config));
	await runtime();
	const message = await probeLocalModels({
		kind: "vllm",
		baseUrl: base,
		endpointId: "local-box",
	}).then(
		() => "resolved",
		(error: Error) => error.message,
	);
	expect(message).toContain("Couldn't resolve the saved API key");
	expect(message).not.toContain("SECRET_COMMAND_SENTINEL");
});

test("an edit keeps an unchanged base URL exactly as written, whatever kind the form picks", async () => {
	await runtime();
	const draft = {
		name: "gateway",
		baseUrl: "http://gpu:8000/openai",
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false }],
	};
	await saveLocalEndpoint({ ...draft, kind: "openai-compatible" });
	await saveLocalEndpoint({ ...draft, id: "local-gateway", kind: "vllm" });
	expect(JSON.parse(readFileSync(path, "utf8")).providers["local-gateway"].baseUrl).toBe(
		"http://gpu:8000/openai",
	);
	await saveLocalEndpoint({
		...draft,
		id: "local-gateway",
		kind: "vllm",
		baseUrl: "http://gpu:8000",
	});
	expect(JSON.parse(readFileSync(path, "utf8")).providers["local-gateway"].baseUrl).toBe(
		"http://gpu:8000/v1",
	);
});

test("only local-* providers are listed, so a hand-written gateway keeps its own compat", async () => {
	const handWritten = {
		providers: {
			gateway: {
				baseUrl: "https://gateway.example/v1",
				api: "openai-completions",
				apiKey: "k",
				compat: { supportsDeveloperRole: true },
				models: [{ id: "m" }],
			},
			"local-box": {
				baseUrl: "http://127.0.0.1:8080/v1",
				api: "openai-completions",
				models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048 }],
			},
		},
	};
	writeFileSync(path, JSON.stringify(handWritten));
	await runtime();
	expect((await listLocalEndpoints()).map((endpoint) => endpoint.id)).toEqual(["local-box"]);
});

test("Detect never sends the key of a provider this feature does not own", async () => {
	const seen: (string | null)[] = [];
	const other = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			seen.push(request.headers.get("authorization"));
			return Response.json({ data: [{ id: "m" }] });
		},
	});
	try {
		const url = `http://127.0.0.1:${other.port}/v1`;
		writeFileSync(
			path,
			JSON.stringify({
				providers: {
					gateway: {
						baseUrl: url,
						api: "openai-completions",
						apiKey: "secret",
						models: [{ id: "m" }],
					},
				},
			}),
		);
		await runtime();
		await probeLocalModels({ kind: "vllm", baseUrl: url, endpointId: "gateway" });
		expect(seen).toEqual([null]);
	} finally {
		other.stop(true);
	}
});

test("a keyed probe refuses redirects and a non-JSON reply is named", async () => {
	const target = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: () => Response.json({ data: [{ id: "m" }] }),
	});
	try {
		const base = serve({});
		server?.stop(true);
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) =>
				new URL(request.url).pathname === "/html/v1/models"
					? new Response("<html></html>", { headers: { "content-type": "text/html" } })
					: Response.redirect(`http://127.0.0.1:${target.port}/v1/models`, 302),
		});
		const origin = `http://127.0.0.1:${server.port}`;
		expect(base).not.toBe(origin);
		await expect(
			probeLocalModels({ kind: "vllm", baseUrl: origin, apiKey: "secret" }),
		).rejects.toThrow("connection failed");
		expect(
			(await probeLocalModels({ kind: "vllm", baseUrl: origin })).models.map((m) => m.id),
		).toEqual(["m"]);
		await expect(
			probeLocalModels({ kind: "openai-compatible", baseUrl: `${origin}/html/v1` }),
		).rejects.toThrow("not a JSON reply");
	} finally {
		target.stop(true);
	}
});

test("a save writes no server kind, can remove the key, and validates model flags", async () => {
	await runtime();
	const draft = {
		kind: "llama.cpp" as const,
		name: "box",
		baseUrl: "http://127.0.0.1:8080/v1",
		apiKey: "secret",
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false }],
	};
	expect((await saveLocalEndpoint(draft))[0]?.hasApiKey).toBe(true);
	const provider = JSON.parse(readFileSync(path, "utf8")).providers["local-box"];
	expect(provider).not.toHaveProperty("kind");
	const removed = await saveLocalEndpoint({ ...draft, id: "local-box", apiKey: "" });
	expect(removed[0]?.hasApiKey).toBe(false);
	expect(JSON.parse(readFileSync(path, "utf8")).providers["local-box"].apiKey).toBe(
		"thinkrail-local",
	);
	const bad = JSON.parse(
		JSON.stringify({ ...draft, models: [{ ...draft.models[0], reasoning: "yes" }] }),
	);
	await expect(saveLocalEndpoint(bad)).rejects.toThrow("Thinking and image input");
});

test("a saved key does not follow the endpoint to a new address", async () => {
	await runtime();
	const draft = {
		kind: "llama.cpp" as const,
		name: "box",
		baseUrl: "http://127.0.0.1:8080/v1",
		apiKey: "secret",
		models: [{ id: "m", contextWindow: 8_192, maxTokens: 2_048, reasoning: false, vision: false }],
	};
	await saveLocalEndpoint(draft);
	const { apiKey: _key, ...withoutKey } = draft;
	await expect(
		saveLocalEndpoint({ ...withoutKey, id: "local-box", baseUrl: "http://10.0.0.9:8080/v1" }),
	).rejects.toThrow("Re-enter the API key");
	await saveLocalEndpoint({ ...withoutKey, id: "local-box", baseUrl: "http://127.0.0.1:8080/v1/" });
	expect(JSON.parse(readFileSync(path, "utf8")).providers["local-box"].apiKey).toBe("secret");
});
