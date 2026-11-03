import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	SubscriptionProviderId,
	SubscriptionUsage,
	SubscriptionUsageRow,
	SubscriptionUsageSnapshot,
	SubscriptionUsageWindow,
} from "@thinkrail/contracts";
import { SUBSCRIPTION_PROVIDER_IDS } from "@thinkrail/contracts";

/**
 * Subscription limits for the sidebar panel.
 *
 * Each provider is asked through whatever it actually exposes: a documented HTTP API, an
 * undocumented one with a locally stored token, or nothing at all. Reading credentials never leaves
 * this module — the snapshot carries percentages and amounts, never tokens.
 */

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface SubscriptionUsageDeps {
	homeDir: string;
	fetchImpl: typeof fetch;
	now: () => number;
	/**
	 * Reads a provider credential through pi's own store. Providers pi does not own — the Codex CLI
	 * and Antigravity — keep their credentials in their own files, which this module reads directly.
	 */
	readPiProviderToken: (providerId: string) => Promise<string | null>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** Providers state reset instants as ISO strings or epoch numbers, in seconds or milliseconds. */
export function resetInstant(value: unknown): number | null {
	const numeric = finiteNumber(value);
	if (numeric !== null) return numeric > 1e11 ? numeric : numeric * 1_000;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
	try {
		return asRecord(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return null;
	}
}

function windowOf(
	usedPercent: number | null,
	windowSeconds: number | null,
	resetsAt: number | null,
	model?: string,
): SubscriptionUsageWindow | null {
	if (usedPercent === null) return null;
	const window: SubscriptionUsageWindow = {
		usedPercent: clampPercent(usedPercent),
		windowSeconds,
		resetsAt,
	};
	if (model !== undefined) window.model = model;
	return window;
}

/** Codex answers with a metered rate-limit window pair plus an optional credit balance. */
export function parseCodexUsage(payload: unknown): SubscriptionUsage {
	const root = asRecord(payload);
	const rateLimit = root ? asRecord(root.rate_limit) : null;
	if (!rateLimit) return { state: "unavailable" };
	const windows: SubscriptionUsageWindow[] = [];
	for (const key of ["primary_window", "secondary_window"] as const) {
		const lane = asRecord(rateLimit[key]);
		if (!lane) continue;
		const window = windowOf(
			finiteNumber(lane.used_percent),
			finiteNumber(lane.limit_window_seconds),
			resetInstant(lane.reset_at),
		);
		if (window) windows.push(window);
	}
	if (windows.length === 0) return { state: "unavailable" };
	return { state: "ok", windows };
}

/** OpenRouter reports money against the key rather than a metered window. */
export function parseOpenRouterKey(payload: unknown): SubscriptionUsage {
	const data = asRecord(asRecord(payload)?.data);
	if (!data) return { state: "unavailable" };
	const usedUsd = finiteNumber(data.usage);
	if (usedUsd === null) return { state: "unavailable" };
	return { state: "ok", windows: [], spend: { usedUsd, limitUsd: finiteNumber(data.limit) } };
}

/** Google Code Assist answers with one quota bucket per model; a full bucket omits its amount. */
export function parseAntigravityQuota(payload: unknown): SubscriptionUsage {
	const buckets = asRecord(payload)?.buckets;
	if (!Array.isArray(buckets)) return { state: "unavailable" };
	const windows: SubscriptionUsageWindow[] = [];
	for (const raw of buckets) {
		const bucket = asRecord(raw);
		if (!bucket) continue;
		const remainingFraction = finiteNumber(bucket.remainingFraction);
		const usedPercent =
			remainingFraction === null ? null : (1 - Math.min(1, Math.max(0, remainingFraction))) * 100;
		const model = typeof bucket.modelId === "string" ? bucket.modelId : undefined;
		const window = windowOf(usedPercent, null, resetInstant(bucket.resetTime), model);
		if (window) windows.push(window);
	}
	if (windows.length === 0) return { state: "unavailable" };
	return { state: "ok", windows };
}

const ANTHROPIC_LANES: Record<string, number> = {
	five_hour: 5 * 60 * 60,
	seven_day: 7 * 24 * 60 * 60,
	seven_day_sonnet: 7 * 24 * 60 * 60,
};

/** Anthropic reports subscription windows as `utilization` percentages per lane. */
export function parseAnthropicUsage(payload: unknown): SubscriptionUsage {
	const root = asRecord(payload);
	if (!root) return { state: "unavailable" };
	const windows: SubscriptionUsageWindow[] = [];
	for (const [lane, windowSeconds] of Object.entries(ANTHROPIC_LANES)) {
		const entry = asRecord(root[lane]);
		if (!entry) continue;
		const window = windowOf(
			finiteNumber(entry.utilization),
			windowSeconds,
			resetInstant(entry.resets_at),
		);
		if (window) windows.push(window);
	}
	if (windows.length === 0) return { state: "unavailable" };
	return { state: "ok", windows };
}

async function fetchJson(
	deps: SubscriptionUsageDeps,
	url: string,
	init: RequestInit,
): Promise<unknown | null> {
	try {
		const response = await deps.fetchImpl(url, {
			...init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}

function bearer(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

/** Codex CLI keeps its ChatGPT session in `~/.codex/auth.json`; an API key alone yields no usage. */
async function codexUsage(deps: SubscriptionUsageDeps): Promise<SubscriptionUsage> {
	const auth = await readJsonFile(join(deps.homeDir, ".codex", "auth.json"));
	const tokens = asRecord(auth?.tokens);
	const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token : null;
	if (!accessToken) return { state: "unavailable" };
	const accountId = typeof tokens?.account_id === "string" ? tokens.account_id : null;
	const payload = await fetchJson(deps, "https://chatgpt.com/backend-api/wham/usage", {
		headers: {
			...bearer(accessToken),
			...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
		},
	});
	return parseCodexUsage(payload);
}

/** Pi stores the Anthropic subscription token; Anthropic may still refuse it per organization. */
async function claudeUsage(deps: SubscriptionUsageDeps): Promise<SubscriptionUsage> {
	const accessToken = await deps.readPiProviderToken("anthropic");
	if (!accessToken) return { state: "unavailable" };
	const payload = await fetchJson(deps, "https://api.anthropic.com/api/oauth/usage", {
		headers: { ...bearer(accessToken), "anthropic-beta": "oauth-2025-04-20" },
	});
	return parseAnthropicUsage(payload);
}

/**
 * Antigravity's Google token only answers while it is still valid: once it expires the row asks for
 * a fresh sign-in instead of pretending the quotas are unknown.
 */
async function antigravityUsage(deps: SubscriptionUsageDeps): Promise<SubscriptionUsage> {
	const creds = await readJsonFile(join(deps.homeDir, ".gemini", "oauth_creds.json"));
	const accessToken = typeof creds?.access_token === "string" ? creds.access_token : null;
	const expiry = finiteNumber(creds?.expiry_date);
	if (!accessToken) return { state: "sign-in" };
	if (expiry !== null && expiry <= deps.now()) return { state: "sign-in" };
	const payload = await fetchJson(
		deps,
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
		{
			method: "POST",
			headers: { ...bearer(accessToken), "Content-Type": "application/json" },
			body: "{}",
		},
	);
	const usage = parseAntigravityQuota(payload);
	return usage.state === "ok" ? usage : { state: "sign-in" };
}

async function openRouterUsage(deps: SubscriptionUsageDeps): Promise<SubscriptionUsage> {
	const accessToken = await deps.readPiProviderToken("openrouter");
	if (!accessToken) return { state: "unavailable" };
	const payload = await fetchJson(deps, "https://openrouter.ai/api/v1/key", {
		headers: bearer(accessToken),
	});
	return parseOpenRouterKey(payload);
}

const COLLECTORS: Record<
	SubscriptionProviderId,
	(deps: SubscriptionUsageDeps) => Promise<SubscriptionUsage>
> = {
	codex: codexUsage,
	claude: claudeUsage,
	antigravity: antigravityUsage,
	openrouter: openRouterUsage,
	"opencode-go": async () => ({ state: "unsupported" }),
	"kimi-coding": async () => ({ state: "unsupported" }),
	deepseek: async () => ({ state: "unsupported" }),
};

let cached: { snapshot: SubscriptionUsageSnapshot; at: number } | null = null;

function defaultDeps(
	readPiProviderToken: SubscriptionUsageDeps["readPiProviderToken"],
): SubscriptionUsageDeps {
	return { homeDir: homedir(), fetchImpl: fetch, now: () => Date.now(), readPiProviderToken };
}

/** One snapshot per minute: the panel polls, and four providers answering a minute apart is enough. */
export async function readSubscriptionUsage(
	options: { force?: boolean; deps?: Partial<SubscriptionUsageDeps> } = {},
): Promise<SubscriptionUsageSnapshot> {
	const deps: SubscriptionUsageDeps = {
		...defaultDeps(options.deps?.readPiProviderToken ?? (async () => null)),
		...options.deps,
	};
	const now = deps.now();
	if (!options.force && cached && now - cached.at < CACHE_TTL_MS) return cached.snapshot;
	const rows = await Promise.all(
		SUBSCRIPTION_PROVIDER_IDS.map(async (providerId): Promise<SubscriptionUsageRow> => {
			try {
				return { providerId, usage: await COLLECTORS[providerId](deps) };
			} catch {
				return { providerId, usage: { state: "unavailable" } };
			}
		}),
	);
	const snapshot: SubscriptionUsageSnapshot = { observedAt: now, rows };
	cached = { snapshot, at: now };
	return snapshot;
}

export function resetSubscriptionUsageCache(): void {
	cached = null;
}
