import { randomBytes } from "node:crypto";
import {
	CUSTOM_ENDPOINT_ID_PREFIX,
	type CustomEndpoint,
	type CustomEndpointDraft,
	type CustomEndpointModel,
	type CustomEndpointProbe,
	type CustomEndpointProbeFailure,
	type CustomEndpointProbeRequest,
	isCustomEndpointId,
} from "@thinkrail/contracts";
import { applyEdits, getNodeValue, modify, type Node } from "jsonc-parser";
import { logger } from "../log";
import { usePiRuntime } from "./agentSessionManager";
import {
	MODELS_JSON_FORMATTING,
	modelsPath,
	parseModelsConfig,
	publishModelsFileChange,
	readModelsSource,
	serializeModelsWrite,
	splitModelsSource,
	writeModelsFile,
} from "./modelsFile";

const log = logger("agent");

const API = "openai-completions";
const NO_KEY = "thinkrail-no-key";
const LIST_TIMEOUT_MS = 5_000;
const DETAIL_TIMEOUT_MS = 3_000;
const MAX_DETAIL_PROBES = 64;
const MAX_MODELS = 500;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
} as const;
const OUTPUT_LIMITS = { min: 256, max: 16_384 } as const;
const CHAT_MODES = new Set(["chat", "completion", "responses"]);
const MANAGED_MODEL_FIELDS = ["contextWindow", "maxTokens", "reasoning", "input"] as const;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function parseBaseUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password || url.search) return null;
	url.hash = "";
	url.pathname =
		url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|models)$/, "") ||
		"/";
	return url.toString().replace(/\/+$/, "");
}

export function defaultMaxTokens(contextWindow: number): number {
	return Math.max(OUTPUT_LIMITS.min, Math.min(OUTPUT_LIMITS.max, Math.floor(contextWindow / 4)));
}

const ENV_REFERENCE = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

export function resolveProbeKey(apiKey: string | undefined): string | undefined {
	const key = apiKey?.trim();
	if (!key || key === NO_KEY || key.startsWith("!")) return undefined;
	const reference = ENV_REFERENCE.exec(key);
	if (!reference) return key;
	return process.env[reference[1] ?? reference[2] ?? ""] || undefined;
}

type Fetched =
	| { ok: true; json: unknown }
	| { ok: false; failure: CustomEndpointProbeFailure; status?: number };

async function fetchJson(
	url: string,
	key: string | undefined,
	timeout: number,
	body?: unknown,
): Promise<Fetched> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (key) headers.authorization = `Bearer ${key}`;
	if (body !== undefined) headers["content-type"] = "application/json";
	let response: Response;
	try {
		response = await fetch(url, {
			method: body === undefined ? "GET" : "POST",
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			redirect: key ? "error" : "follow",
			signal: AbortSignal.timeout(timeout),
		});
	} catch (error) {
		return {
			ok: false,
			failure: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable",
		};
	}
	if (response.status === 401 || response.status === 403)
		return { ok: false, failure: "unauthorized", status: response.status };
	if (!response.ok) return { ok: false, failure: "not-openai", status: response.status };
	try {
		return { ok: true, json: await response.json() };
	} catch {
		return { ok: false, failure: "not-openai" };
	}
}

async function detail(url: string, key: string | undefined, body?: unknown): Promise<unknown> {
	const result = await fetchJson(url, key, DETAIL_TIMEOUT_MS, body);
	return result.ok ? result.json : undefined;
}

export function parseModelList(payload: unknown): CustomEndpointModel[] | null {
	if (!isObject(payload) || !Array.isArray(payload.data)) return null;
	const seen = new Set<string>();
	const models: CustomEndpointModel[] = [];
	for (const entry of payload.data) {
		if (!isObject(entry) || typeof entry.id !== "string" || entry.id === "") continue;
		if (seen.has(entry.id)) continue;
		if (typeof entry.mode === "string" && !CHAT_MODES.has(entry.mode)) continue;
		const architecture = isObject(entry.architecture) ? entry.architecture : {};
		const output = strings(architecture.output_modalities);
		if (output.length > 0 && !output.includes("text")) continue;
		const meta = isObject(entry.meta) ? entry.meta : {};
		const input = strings(architecture.input_modalities);
		seen.add(entry.id);
		models.push({
			id: entry.id,
			contextWindow:
				positiveInt(entry.max_model_len) ??
				positiveInt(entry.max_input_tokens) ??
				positiveInt(entry.context_length) ??
				positiveInt(meta.n_ctx),
			maxTokens: positiveInt(entry.max_output_tokens),
			reasoning: null,
			vision: input.length > 0 ? input.includes("image") : null,
			tools: null,
		});
	}
	return models;
}

async function enrichLlamaCpp(root: string, key: string | undefined) {
	const props = await detail(`${root}/props`, key);
	if (!isObject(props) || !isObject(props.default_generation_settings)) return undefined;
	const caps = isObject(props.chat_template_caps) ? props.chat_template_caps : {};
	return {
		contextWindow: positiveInt(props.default_generation_settings.n_ctx),
		reasoning:
			typeof props.chat_template === "string" && props.chat_template.includes("enable_thinking")
				? true
				: null,
		tools: typeof caps.supports_tools === "boolean" ? caps.supports_tools : null,
	};
}

function ollamaContext(parameters: unknown): number | null {
	if (typeof parameters !== "string") return null;
	const match = /^\s*num_ctx\s+(\d+)\s*$/m.exec(parameters);
	return match ? positiveInt(Number(match[1])) : null;
}

async function enrichOllama(
	root: string,
	key: string | undefined,
	models: CustomEndpointModel[],
): Promise<CustomEndpointModel[] | undefined> {
	const version = await detail(`${root}/api/version`, key);
	if (!isObject(version) || typeof version.version !== "string") return undefined;
	const shown = await Promise.all(
		models.map(async (model, index) => {
			if (index >= MAX_DETAIL_PROBES) return model;
			const show = await detail(`${root}/api/show`, key, { model: model.id });
			if (!isObject(show) || !Array.isArray(show.capabilities)) return model;
			const capabilities = strings(show.capabilities);
			if (!capabilities.includes("completion")) return null;
			return {
				...model,
				contextWindow: model.contextWindow ?? ollamaContext(show.parameters),
				reasoning: capabilities.includes("thinking"),
				vision: capabilities.includes("vision"),
				tools: capabilities.includes("tools"),
			};
		}),
	);
	return shown.filter((model): model is CustomEndpointModel => model !== null);
}

async function enrichLmStudio(root: string, key: string | undefined) {
	const listing = await detail(`${root}/api/v0/models`, key);
	if (!isObject(listing) || !Array.isArray(listing.data)) return undefined;
	const details = new Map<string, Json>();
	for (const entry of listing.data)
		if (isObject(entry) && typeof entry.id === "string") details.set(entry.id, entry);
	return details;
}

async function enrich(
	baseUrl: string,
	key: string | undefined,
	models: CustomEndpointModel[],
): Promise<CustomEndpointModel[]> {
	const root = baseUrl.replace(/\/v1$/, "");
	const [llama, ollama, lmStudio] = await Promise.all([
		enrichLlamaCpp(root, key),
		enrichOllama(root, key, models),
		enrichLmStudio(root, key),
	]);
	let next = ollama ?? models;
	if (llama)
		next = next.map((model) => ({
			...model,
			contextWindow: llama.contextWindow ?? model.contextWindow,
			reasoning: model.reasoning ?? llama.reasoning,
			tools: model.tools ?? llama.tools,
		}));
	if (lmStudio)
		next = next.flatMap((model) => {
			const entry = lmStudio.get(model.id);
			if (!entry) return [model];
			if (entry.type === "embeddings") return [];
			return [
				{
					...model,
					contextWindow: model.contextWindow ?? positiveInt(entry.loaded_context_length),
					vision:
						entry.type === "vlm" || entry.type === "llm" ? entry.type === "vlm" : model.vision,
					tools: Array.isArray(entry.capabilities)
						? entry.capabilities.includes("tool_use")
						: model.tools,
				},
			];
		});
	return next;
}

function savedKey(id: string, baseUrl: string): string | undefined {
	const provider = providersOf(parseModelsConfig(readModelsSource(modelsPath())))[id];
	if (!isCustomEndpointId(id) || !isObject(provider)) return undefined;
	if (typeof provider.baseUrl !== "string" || parseBaseUrl(provider.baseUrl) !== baseUrl)
		return undefined;
	return typeof provider.apiKey === "string" ? resolveProbeKey(provider.apiKey) : undefined;
}

export async function probeCustomEndpoint(
	request: CustomEndpointProbeRequest,
): Promise<CustomEndpointProbe> {
	if (!isObject(request) || typeof request.baseUrl !== "string")
		throw new Error("The server address must be text.");
	if (request.apiKey !== undefined && typeof request.apiKey !== "string")
		throw new Error("The API key must be text.");
	let baseUrl = parseBaseUrl(request.baseUrl);
	if (!baseUrl) return { ok: false, reason: "invalid-url" };
	const key =
		request.apiKey === undefined && typeof request.endpointId === "string"
			? savedKey(request.endpointId, baseUrl)
			: resolveProbeKey(request.apiKey);
	let listing = await fetchJson(`${baseUrl}/models`, key, LIST_TIMEOUT_MS);
	if (!listing.ok && listing.status === 404 && !baseUrl.endsWith("/v1")) {
		const versioned = await fetchJson(`${baseUrl}/v1/models`, key, LIST_TIMEOUT_MS);
		if (versioned.ok) baseUrl = `${baseUrl}/v1`;
		if (versioned.ok || versioned.status !== 404) listing = versioned;
	}
	if (!listing.ok)
		return {
			ok: false,
			reason: listing.failure,
			...(listing.status === undefined ? {} : { status: listing.status }),
		};
	const models = parseModelList(listing.json);
	if (models === null) return { ok: false, reason: "not-openai" };
	if (models.length === 0) return { ok: false, reason: "no-models" };
	return { ok: true, baseUrl, models: await enrich(baseUrl, key, models) };
}

function readModel(raw: unknown, overrides: Json): CustomEndpointModel | undefined {
	if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") return undefined;
	const override = overrides[raw.id];
	const model = isObject(override) ? { ...raw, ...override } : raw;
	return {
		id: raw.id,
		contextWindow: positiveInt(model.contextWindow),
		maxTokens: positiveInt(model.maxTokens),
		reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null,
		vision: Array.isArray(model.input) ? strings(model.input).includes("image") : null,
		tools: null,
	};
}

function providersOf(config: Node | undefined): Json {
	const root = config ? getNodeValue(config) : undefined;
	return isObject(root) && isObject(root.providers) ? root.providers : {};
}

function readEndpoints(config: Node | undefined): CustomEndpoint[] {
	return Object.entries(providersOf(config)).flatMap(([id, provider]) => {
		if (!isCustomEndpointId(id) || !isObject(provider)) return [];
		if (provider.api !== API || typeof provider.baseUrl !== "string") return [];
		if (!parseBaseUrl(provider.baseUrl) || !Array.isArray(provider.models)) return [];
		const overrides = isObject(provider.modelOverrides) ? provider.modelOverrides : {};
		const apiKey = typeof provider.apiKey === "string" ? provider.apiKey : undefined;
		return [
			{
				id,
				name: typeof provider.name === "string" && provider.name ? provider.name : id,
				baseUrl: provider.baseUrl,
				hasApiKey: apiKey !== undefined && apiKey !== NO_KEY,
				models: provider.models.flatMap((model) => readModel(model, overrides) ?? []),
			},
		];
	});
}

export function listCustomEndpoints(): Promise<CustomEndpoint[]> {
	return Promise.resolve(readEndpoints(parseModelsConfig(readModelsSource(modelsPath()))));
}

function slug(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 40)
		.replace(/^-+|-+$/g, "");
}

function newEndpointId(name: string, baseUrl: string, config: Node | undefined): string {
	const taken = new Set(Object.keys(providersOf(config)));
	const host = parseBaseUrl(baseUrl);
	const fallback = host ? slug(new URL(host).hostname) : "";
	const base = `${CUSTOM_ENDPOINT_ID_PREFIX}${slug(name) || fallback || "server"}`;
	let id: string;
	do id = `${base}-${randomBytes(3).toString("hex")}`;
	while (taken.has(id));
	return id;
}

function isCount(value: unknown): boolean {
	return value === null || positiveInt(value) !== null;
}

function isFlag(value: unknown): boolean {
	return value === null || typeof value === "boolean";
}

function validateDraft(draft: CustomEndpointDraft): void {
	if (!isObject(draft) || typeof draft.name !== "string" || typeof draft.baseUrl !== "string")
		throw new Error("Name and server address must be text.");
	if (draft.id !== undefined && typeof draft.id !== "string")
		throw new Error("That server is no longer in models.json. Reload and retry.");
	if (draft.apiKey !== undefined && typeof draft.apiKey !== "string")
		throw new Error("The API key must be text.");
	if (!draft.name.trim()) throw new Error("Name the server.");
	if (!parseBaseUrl(draft.baseUrl))
		throw new Error("Enter a full http:// or https:// address without credentials or a query.");
	if (!Array.isArray(draft.models) || draft.models.length === 0)
		throw new Error("Pick at least one model.");
	if (draft.models.length > MAX_MODELS) throw new Error("Pick fewer models.");
	const ids = new Set<string>();
	for (const model of draft.models) {
		if (!isObject(model) || typeof model.id !== "string" || !model.id.trim() || ids.has(model.id))
			throw new Error("Model ids must be unique and non-empty.");
		ids.add(model.id);
		if (!isCount(model.contextWindow) || !isCount(model.maxTokens))
			throw new Error("Model limits must be whole numbers.");
		if (!isFlag(model.reasoning) || !isFlag(model.vision))
			throw new Error("Model capabilities must be on or off.");
	}
}

function maxTokensFor(model: CustomEndpointModel): number | null {
	const context = model.contextWindow;
	if (model.maxTokens !== null && (context === null || model.maxTokens < context))
		return model.maxTokens;
	return context === null ? null : defaultMaxTokens(context);
}

function modelConfig(model: CustomEndpointModel, previous: Json | undefined): Json {
	const next: Json = {
		...(previous ?? {}),
		id: model.id,
		name: typeof previous?.name === "string" ? previous.name : model.id,
		cost: isObject(previous?.cost) ? previous.cost : ZERO_COST,
	};
	if (model.reasoning === null) delete next.reasoning;
	else next.reasoning = model.reasoning;
	if (model.vision === null) delete next.input;
	else next.input = model.vision ? ["text", "image"] : ["text"];
	const maxTokens = maxTokensFor(model);
	if (model.contextWindow === null) delete next.contextWindow;
	else next.contextWindow = model.contextWindow;
	if (maxTokens === null) delete next.maxTokens;
	else next.maxTokens = maxTokens;
	return next;
}

function withoutManagedOverrides(overrides: unknown, ids: Set<string>): Json | undefined {
	if (!isObject(overrides)) return undefined;
	const next: Json = {};
	for (const [id, override] of Object.entries(overrides)) {
		if (!ids.has(id) || !isObject(override)) {
			next[id] = override;
			continue;
		}
		const kept: Json = { ...override };
		for (const field of MANAGED_MODEL_FIELDS) delete kept[field];
		if (Object.keys(kept).length > 0) next[id] = kept;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function routesElsewhere(provider: Json | undefined, baseUrl: string): boolean {
	if (!provider) return false;
	const origin = originOf(baseUrl);
	const models = Array.isArray(provider.models) ? provider.models : [];
	const overrides = isObject(provider.modelOverrides) ? Object.values(provider.modelOverrides) : [];
	return [...models, ...overrides].some(
		(entry) =>
			isObject(entry) && typeof entry.baseUrl === "string" && originOf(entry.baseUrl) !== origin,
	);
}

function providerConfig(draft: CustomEndpointDraft, previous: Json | undefined): Json {
	const previousUrl = typeof previous?.baseUrl === "string" ? previous.baseUrl : undefined;
	const baseUrl =
		previousUrl !== undefined && draft.baseUrl.trim() === previousUrl
			? previousUrl
			: (parseBaseUrl(draft.baseUrl) ?? draft.baseUrl.trim());
	const previousKey = typeof previous?.apiKey === "string" ? previous.apiKey : undefined;
	if (previousUrl !== undefined && originOf(previousUrl) !== originOf(baseUrl))
		throw new Error("A server keeps its address. Add a different server as a new one.");
	if (routesElsewhere(previous, baseUrl))
		throw new Error(
			"Some of this server's models are routed to another address in models.json. Edit it there.",
		);
	const previousModels = new Map<string, Json>();
	for (const model of Array.isArray(previous?.models) ? previous.models : [])
		if (isObject(model) && typeof model.id === "string") previousModels.set(model.id, model);
	const next: Json = {
		...(previous ?? {}),
		name: draft.name.trim(),
		baseUrl,
		api: API,
		apiKey: draft.apiKey === undefined ? (previousKey ?? NO_KEY) : draft.apiKey.trim() || NO_KEY,
		compat: previous === undefined ? { ...COMPAT } : previous.compat,
		models: draft.models.map((model) => modelConfig(model, previousModels.get(model.id))),
	};
	if (next.compat === undefined) delete next.compat;
	const overrides = withoutManagedOverrides(
		previous?.modelOverrides,
		new Set(draft.models.map((model) => model.id)),
	);
	if (overrides) next.modelOverrides = overrides;
	else delete next.modelOverrides;
	return next;
}

function commit(edit: (body: string, config: Node | undefined) => string | null) {
	return serializeModelsWrite(() =>
		usePiRuntime(async (runtime) => {
			const path = modelsPath();
			const source = readModelsSource(path);
			const config = parseModelsConfig(source);
			const { bom, body } = splitModelsSource(source);
			const edited = edit(body, config);
			if (edited === null) return readEndpoints(config);
			const next = bom + edited;
			if (next !== source) {
				writeModelsFile(path, next);
				await runtime
					.refresh({ allowNetwork: false })
					.catch((error: unknown) =>
						log.warn("pi runtime refresh after a custom endpoint save failed", error),
					);
				publishModelsFileChange();
			}
			return readEndpoints(parseModelsConfig(next));
		}),
	);
}

export function saveCustomEndpoint(draft: CustomEndpointDraft): Promise<CustomEndpoint[]> {
	try {
		validateDraft(draft);
	} catch (error) {
		return Promise.reject(error);
	}
	return commit((body, config) => {
		if (draft.id !== undefined && !readEndpoints(config).some((e) => e.id === draft.id))
			throw new Error("That server is no longer in models.json. Reload and retry.");
		const id = draft.id ?? newEndpointId(draft.name, draft.baseUrl, config);
		const previous = draft.id === undefined ? undefined : providersOf(config)[draft.id];
		const value = providerConfig(draft, isObject(previous) ? previous : undefined);
		return applyEdits(body, modify(body, ["providers", id], value, MODELS_JSON_FORMATTING));
	});
}

export function removeCustomEndpoint(id: string): Promise<CustomEndpoint[]> {
	return commit((body, config) => {
		if (!readEndpoints(config).some((endpoint) => endpoint.id === id)) return null;
		return applyEdits(body, modify(body, ["providers", id], undefined, MODELS_JSON_FORMATTING));
	});
}
