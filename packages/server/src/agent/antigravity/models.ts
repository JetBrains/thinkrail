import type { RefreshModelsContext, ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { antigravityHeaders, endpointCandidates, parseAntigravityApiKey } from "./client";
import { getAntigravityApiKey, refreshAntigravityToken } from "./oauth";

const geminiFlashCost = { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 };
const geminiProCost = { input: 1.25, output: 5.0, cacheRead: 0.3125, cacheWrite: 1.25 };
const claudeSonnetCost = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };
const claudeOpusCost = { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 };
const gptOssCost = { input: 0.6, output: 2.4, cacheRead: 0.15, cacheWrite: 0.6 };

const lowMediumHighThinkingMap: ThinkingLevelMap = {
	off: null,
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: null,
	max: null,
};

export const ANTIGRAVITY_MODELS: ProviderModelConfig[] = [
	{
		id: "gemini-4-argon",
		name: "Gemini 4 Argon (Antigravity)",
		reasoning: true,
		thinkingLevelMap: lowMediumHighThinkingMap,
		input: ["text", "image"],
		cost: geminiProCost,
		contextWindow: 1048576,
		maxTokens: 65536,
	},
];

export interface ModelVariants {
	low?: string | undefined;
	medium?: string | undefined;
	high?: string | undefined;
}

export type AntigravityModelFamily = "gemini" | "claude" | "other";

export function getModelFamily(modelId: string): AntigravityModelFamily {
	const lower = modelId.toLowerCase();
	if (lower.includes("gemini") || lower.includes("argon")) return "gemini";
	if (lower.includes("claude")) return "claude";
	return "other";
}

const SEED_VARIANTS: Readonly<Record<string, ModelVariants>> = {
	"gemini-4-argon": {
		low: "gemini-4-argon-low",
		medium: "gemini-4-argon-medium",
		high: "gemini-4-argon-high",
	},
};

const STATIC_MODEL_ENUMS: Record<string, string> = {
	"gemini-4-argon-high": "MODEL_PLACEHOLDER_M417",
	"gemini-4-argon-medium": "MODEL_PLACEHOLDER_M418",
	"gemini-4-argon-low": "MODEL_PLACEHOLDER_M419",
};

const dynamicModelEnums = new Map<string, string>();
const dynamicVariantRouting = new Map<string, ModelVariants>();
const dynamicMaxOutputTokens = new Map<string, number>();

export function getAntigravityModelEnum(modelId: string): string | undefined {
	return dynamicModelEnums.get(modelId) ?? STATIC_MODEL_ENUMS[modelId];
}

function resolveVariant(baseId: string, variants: ModelVariants, effort?: string): string {
	if (effort === "high" || effort === "xhigh") {
		return variants.high ?? variants.medium ?? variants.low ?? baseId;
	}
	if (effort === "low" || effort === "minimal") {
		return variants.low ?? variants.medium ?? variants.high ?? baseId;
	}
	return variants.medium ?? variants.high ?? variants.low ?? baseId;
}

export function getAntigravityRequestModelId(modelId: string, effort?: string): string {
	const variants = dynamicVariantRouting.get(modelId) ?? SEED_VARIANTS[modelId];
	return variants ? resolveVariant(modelId, variants, effort) : modelId;
}

export interface ThinkingWire {
	includeThoughts: boolean;
	thinkingBudget: number;
}

export function getThinkingConfig(
	modelId: string,
	effort: string | undefined,
): ThinkingWire | undefined {
	const family = getModelFamily(modelId);
	if (!effort || effort === "off") {
		if (family === "claude" || family === "other") {
			return { includeThoughts: false, thinkingBudget: 0 };
		}
		return undefined;
	}

	if (family === "claude") {
		return { includeThoughts: true, thinkingBudget: 1024 };
	}
	if (family === "gemini") {
		const thinkingBudget =
			effort === "high" || effort === "xhigh" ? -1 : effort === "medium" ? 4_000 : 1_000;
		return { includeThoughts: true, thinkingBudget };
	}
	return { includeThoughts: true, thinkingBudget: 8192 };
}

export function getMaxOutputTokens(modelId: string, runtimeModel?: string): number {
	const target = runtimeModel || modelId;
	const dynamic = dynamicMaxOutputTokens.get(target) ?? dynamicMaxOutputTokens.get(modelId);
	if (dynamic !== undefined) return dynamic;
	const family = getModelFamily(target);
	if (family === "claude") return 64000;
	if (family === "gemini") return 65536;
	return 32768;
}

export interface RawAntigravityModel {
	displayName?: string;
	model?: string;
	maxTokens?: number;
	maxOutputTokens?: number;
	supportsImages?: boolean;
}

export interface RawAntigravityModelsResponse {
	models?: Record<string, RawAntigravityModel>;
	agentModelSorts?: Array<{
		groups?: Array<{
			modelIds?: string[];
		}>;
	}>;
}

function parseVariantSuffix(rawId: string): { baseId: string; effort?: "low" | "medium" | "high" } {
	if (rawId.endsWith("-high")) {
		return { baseId: rawId.slice(0, -5), effort: "high" };
	}
	if (rawId.endsWith("-medium")) {
		return { baseId: rawId.slice(0, -7), effort: "medium" };
	}
	if (rawId.endsWith("-low")) {
		return { baseId: rawId.slice(0, -4), effort: "low" };
	}
	return { baseId: rawId };
}

function formatModelName(baseId: string, rawName?: string): string {
	if (!rawName) return baseId;
	const clean = rawName.replace(/\s*\((Low|Medium|High|Extra Low)\)/gi, "").trim();
	if (clean.endsWith("(Antigravity)")) return clean;
	return `${clean} (Antigravity)`;
}

function inferModelCost(baseId: string) {
	const lower = baseId.toLowerCase();
	if (lower.includes("opus")) return claudeOpusCost;
	if (lower.includes("sonnet")) return claudeSonnetCost;
	if (lower.includes("pro") || lower.includes("argon")) return geminiProCost;
	if (lower.includes("flash")) return geminiFlashCost;
	const family = getModelFamily(baseId);
	if (family === "claude") return claudeSonnetCost;
	if (family === "gemini") return geminiProCost;
	return gptOssCost;
}

interface TextModelConfig {
	id: string;
	name: string;
	reasoning?: boolean | undefined;
	thinkingLevelMap?: ThinkingLevelMap | undefined;
	input: Array<"text" | "image">;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

function isTextModelConfig(model: unknown): model is TextModelConfig {
	return (
		typeof model === "object" && model !== null && "contextWindow" in model && "maxTokens" in model
	);
}

interface GroupedModel {
	baseId: string;
	displayName?: string | undefined;
	variants: ModelVariants;
	rawList: RawAntigravityModel[];
}

function recordDynamicMetadata(rawModels: Record<string, RawAntigravityModel>): void {
	for (const [id, raw] of Object.entries(rawModels)) {
		if (raw && typeof raw.model === "string" && raw.model.trim()) {
			dynamicModelEnums.set(id, raw.model.trim());
		}
		if (raw && typeof raw.maxOutputTokens === "number" && raw.maxOutputTokens > 0) {
			dynamicMaxOutputTokens.set(id, raw.maxOutputTokens);
		}
	}
}

function collectPriorityIds(sorts: RawAntigravityModelsResponse["agentModelSorts"]): string[] {
	if (!Array.isArray(sorts)) return [];
	const priorityIds: string[] = [];
	const seen = new Set<string>();
	for (const sort of sorts) {
		if (!Array.isArray(sort?.groups)) continue;
		for (const group of sort.groups) {
			if (!Array.isArray(group?.modelIds)) continue;
			for (const id of group.modelIds) {
				if (typeof id === "string" && !seen.has(id)) {
					seen.add(id);
					priorityIds.push(id);
				}
			}
		}
	}
	return priorityIds;
}

function collectOrderedModelIds(
	rawModels: Record<string, RawAntigravityModel>,
	priorityIds: string[],
): string[] {
	if (priorityIds.length > 0) {
		return priorityIds;
	}
	const ordered: string[] = [];
	for (const [key, raw] of Object.entries(rawModels)) {
		if (raw && typeof raw.displayName === "string" && raw.displayName.trim()) {
			ordered.push(key);
		}
	}
	return ordered;
}

function groupModelVariants(
	rawModels: Record<string, RawAntigravityModel>,
	orderedIds: string[],
): Map<string, GroupedModel> {
	const groups = new Map<string, GroupedModel>();
	for (const rawId of orderedIds) {
		const raw = rawModels[rawId];
		if (!raw) continue;
		const { baseId, effort } = parseVariantSuffix(rawId);
		let group = groups.get(baseId);
		if (!group) {
			group = { baseId, displayName: raw.displayName, variants: {}, rawList: [] };
			groups.set(baseId, group);
		}
		if (effort) {
			group.variants[effort] = rawId;
		}
		group.rawList.push(raw);
		if (raw.displayName && (!group.displayName || effort === "medium" || effort === "high")) {
			group.displayName = raw.displayName;
		}
	}
	return groups;
}

function toProviderModelConfig(group: GroupedModel): ProviderModelConfig {
	const baseId = group.baseId;
	dynamicVariantRouting.set(baseId, group.variants);

	const defaultVariant = group.variants.medium ?? group.variants.high ?? group.variants.low;
	const defaultVariantEnum = defaultVariant ? dynamicModelEnums.get(defaultVariant) : undefined;
	if (defaultVariantEnum) {
		dynamicModelEnums.set(baseId, defaultVariantEnum);
	}

	const staticMatch = ANTIGRAVITY_MODELS.find((m) => m.id === baseId);
	const staticText = isTextModelConfig(staticMatch) ? staticMatch : undefined;

	const hasLow = Boolean(group.variants.low);
	const hasMedium = Boolean(group.variants.medium);
	const hasHigh = Boolean(group.variants.high);
	let thinkingLevelMap: ThinkingLevelMap | undefined = staticText?.thinkingLevelMap;
	if (hasLow || hasMedium || hasHigh) {
		thinkingLevelMap = {
			off: null,
			minimal: null,
			low: hasLow ? "low" : null,
			medium: hasMedium ? "medium" : null,
			high: hasHigh ? "high" : null,
			xhigh: null,
			max: null,
		};
	}

	const supportsImages =
		group.rawList.some((r) => r.supportsImages) || (staticText?.input.includes("image") ?? false);

	let contextWindowFromMeta: number | undefined;
	let maxTokensFromMeta: number | undefined;
	for (const r of group.rawList) {
		if (typeof r.maxTokens === "number" && r.maxTokens > 0) {
			contextWindowFromMeta = Math.max(contextWindowFromMeta ?? 0, r.maxTokens);
		}
		if (typeof r.maxOutputTokens === "number" && r.maxOutputTokens > 0) {
			maxTokensFromMeta = Math.max(maxTokensFromMeta ?? 0, r.maxOutputTokens);
		}
	}

	const contextWindow = contextWindowFromMeta ?? staticText?.contextWindow ?? 1048576;
	const maxTokens = maxTokensFromMeta ?? staticText?.maxTokens ?? 65536;
	dynamicMaxOutputTokens.set(baseId, maxTokens);

	return {
		id: baseId,
		name: staticText?.name ?? formatModelName(baseId, group.displayName),
		reasoning: Boolean(thinkingLevelMap) || (staticText?.reasoning ?? false),
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		input: supportsImages ? ["text", "image"] : ["text"],
		cost: staticText?.cost ?? inferModelCost(baseId),
		contextWindow,
		maxTokens,
	};
}

export function buildAntigravityCatalog(data: unknown): ProviderModelConfig[] {
	if (!data || typeof data !== "object") return ANTIGRAVITY_MODELS;
	const resp = data as RawAntigravityModelsResponse;
	if (!resp.models || typeof resp.models !== "object") return ANTIGRAVITY_MODELS;

	recordDynamicMetadata(resp.models);
	const priorityIds = collectPriorityIds(resp.agentModelSorts);
	const orderedIds = collectOrderedModelIds(resp.models, priorityIds);
	const groups = groupModelVariants(resp.models, orderedIds);

	const models = Array.from(groups.values()).map(toProviderModelConfig);
	return models.length > 0 ? models : ANTIGRAVITY_MODELS;
}

let lastPersonalizedCatalog: ProviderModelConfig[] | null = null;

export function resetAntigravityCatalogForTests(): void {
	lastPersonalizedCatalog = null;
	dynamicModelEnums.clear();
	dynamicVariantRouting.clear();
	dynamicMaxOutputTokens.clear();
}

export async function refreshAntigravityModels(
	context: RefreshModelsContext,
): Promise<ProviderModelConfig[]> {
	if (!context.credential) {
		lastPersonalizedCatalog = null;
		return ANTIGRAVITY_MODELS;
	}

	let apiKey: string | undefined;
	const oauthCreds =
		context.credential.type === "oauth" ? (context.credential as OAuthCredentials) : undefined;
	if (
		oauthCreds &&
		typeof oauthCreds.refresh === "string" &&
		(!oauthCreds.expires || oauthCreds.expires <= Date.now() + 60_000)
	) {
		try {
			const refreshed = await refreshAntigravityToken(oauthCreds);
			oauthCreds.access = refreshed.access;
			oauthCreds.expires = refreshed.expires;
		} catch {}
	}

	if (context.credential.type === "api_key") {
		apiKey = typeof context.credential.key === "string" ? context.credential.key : undefined;
	} else if (context.credential.type === "oauth") {
		apiKey = getAntigravityApiKey(context.credential);
	}

	if (!apiKey) {
		lastPersonalizedCatalog = null;
		return ANTIGRAVITY_MODELS;
	}

	if (!context.allowNetwork || context.signal?.aborted) {
		return lastPersonalizedCatalog ?? ANTIGRAVITY_MODELS;
	}

	try {
		let creds = parseAntigravityApiKey(apiKey);
		for (const endpoint of endpointCandidates()) {
			try {
				let res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
					method: "POST",
					headers: antigravityHeaders(creds.token),
					body: JSON.stringify({ project: creds.projectId }),
					signal: context.signal,
				});
				if (res.status === 401 && oauthCreds && typeof oauthCreds.refresh === "string") {
					try {
						const refreshed = await refreshAntigravityToken(oauthCreds);
						oauthCreds.access = refreshed.access;
						oauthCreds.expires = refreshed.expires;
						creds = parseAntigravityApiKey(getAntigravityApiKey(oauthCreds));
						res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
							method: "POST",
							headers: antigravityHeaders(creds.token),
							body: JSON.stringify({ project: creds.projectId }),
							signal: context.signal,
						});
					} catch {}
				}
				if (!res.ok) continue;
				const data = (await res.json()) as RawAntigravityModelsResponse;
				if (data && typeof data === "object" && data.models && typeof data.models === "object") {
					const catalog = buildAntigravityCatalog(data);
					lastPersonalizedCatalog = catalog;
					return catalog;
				}
			} catch {}
		}
	} catch (err) {
		if (context.force) throw err;
	}

	return lastPersonalizedCatalog ?? ANTIGRAVITY_MODELS;
}
