import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { logger } from "../log";

const log = logger("agent");

const CHATGPT_SIGN_IN_BASE_URL = "https://api.openai.com/v1";
const CHATGPT_ALLOWLIST_PROVIDER = "openai-codex";
const LISTING_TIMEOUT_MS = 5_000;
const LISTING_TTL_MS = 60_000;
const DATE_SUFFIX = /^-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

export type ModelAvailabilityRuntime = Pick<
	ModelRuntime,
	"getAvailableSnapshot" | "getModels" | "isUsingOAuth"
>;

export type ModelListingRuntime = Pick<ModelRuntime, "getModels" | "getAuth">;

interface ProviderListing {
	baseUrl: string;
	ids: ReadonlySet<string>;
}

interface ListingState {
	listings: ReadonlyMap<string, ProviderListing>;
	checkedAt: number;
	inflight?: Promise<boolean>;
}

const listingStates = new WeakMap<object, ListingState>();
let publishListingChange: (() => void) | null = null;

export function setModelListingPublisher(publisher: (() => void) | null): void {
	publishListingChange = publisher;
}

export function accountAvailableModels(runtime: ModelAvailabilityRuntime): readonly Model<Api>[] {
	const snapshot = runtime.getAvailableSnapshot();
	const chatgpt = chatgptAllowlist(runtime);
	const listings = listingStates.get(runtime)?.listings;
	if (!chatgpt && !listings?.size) return snapshot;
	return snapshot.filter((model) => {
		if (chatgpt && model.provider === "openai" && model.baseUrl === CHATGPT_SIGN_IN_BASE_URL)
			return chatgpt.has(model.id);
		const listing = listings?.get(model.provider);
		return !listing || listing.baseUrl !== model.baseUrl || isListed(listing.ids, model.id);
	});
}

function chatgptAllowlist(runtime: ModelAvailabilityRuntime): ReadonlySet<string> | undefined {
	if (!runtime.isUsingOAuth("openai")) return undefined;
	const ids = new Set(runtime.getModels(CHATGPT_ALLOWLIST_PROVIDER).map((model) => model.id));
	return ids.size > 0 ? ids : undefined;
}

function isListed(ids: ReadonlySet<string>, id: string): boolean {
	if (ids.has(id)) return true;
	for (const listed of ids) {
		if (listed.startsWith(id) && DATE_SUFFIX.test(listed.slice(id.length))) return true;
	}
	return false;
}

export function refreshModelListings(
	runtime: ModelListingRuntime,
	providerIds: ReadonlySet<string>,
	{ force = false }: { force?: boolean } = {},
): Promise<boolean> {
	const state = listingStates.get(runtime);
	if (state?.inflight) return state.inflight;
	if (!force && state && Date.now() - state.checkedAt < LISTING_TTL_MS)
		return Promise.resolve(false);
	const previous = state?.listings ?? new Map<string, ProviderListing>();
	const inflight = readListings(runtime, providerIds).then((fresh) => {
		const listings = new Map([...previous].filter(([providerId]) => providerIds.has(providerId)));
		for (const [providerId, listing] of fresh) listings.set(providerId, listing);
		listingStates.set(runtime, { listings, checkedAt: Date.now() });
		const changed = !sameListings(previous, listings);
		if (changed) publishListingChange?.();
		return changed;
	});
	listingStates.set(runtime, { listings: previous, checkedAt: state?.checkedAt ?? 0, inflight });
	return inflight;
}

async function readListings(
	runtime: ModelListingRuntime,
	providerIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, ProviderListing>> {
	const entries = await Promise.all(
		[...providerIds].map(async (providerId) => {
			const listing = await readProviderListing(runtime, providerId).catch((error: unknown) => {
				log.warn(`model listing for ${providerId} unavailable: ${String(error)}`);
				return undefined;
			});
			return listing ? ([providerId, listing] as const) : undefined;
		}),
	);
	return new Map(entries.filter((entry) => entry !== undefined));
}

async function readProviderListing(
	runtime: ModelListingRuntime,
	providerId: string,
): Promise<ProviderListing | undefined> {
	const models = runtime.getModels(providerId);
	const baseUrl = models[0]?.baseUrl;
	if (!baseUrl || models.some((model) => model.baseUrl !== baseUrl)) return undefined;
	const auth = (await runtime.getAuth(providerId))?.auth;
	if (!auth) return undefined;
	const request = listingRequest(models[0]?.api ?? "", baseUrl, auth.apiKey);
	if (!request) return undefined;
	const headers = new Headers();
	for (const [name, value] of Object.entries(auth.headers ?? {})) {
		if (typeof value === "string") headers.set(name, value);
	}
	for (const [name, value] of Object.entries(request.headers)) headers.set(name, value);
	const response = await fetch(request.url, {
		headers,
		signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
	});
	if (!response.ok) return undefined;
	const body = (await response.json()) as { data?: unknown };
	if (!Array.isArray(body.data)) return undefined;
	const ids = new Set(
		body.data.flatMap((entry: unknown) =>
			entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string"
				? [entry.id]
				: [],
		),
	);
	return ids.size > 0 ? { baseUrl, ids } : undefined;
}

function listingRequest(
	api: string,
	baseUrl: string,
	apiKey: string | undefined,
): { url: string; headers: Record<string, string> } | undefined {
	const root = baseUrl.replace(/\/+$/, "");
	if (api === "openai-responses" || api === "openai-completions")
		return {
			url: `${root}/models`,
			headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
		};
	if (api === "anthropic-messages")
		return {
			url: `${root}/v1/models?limit=1000`,
			headers: { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) },
		};
	return undefined;
}

function sameListings(
	left: ReadonlyMap<string, ProviderListing>,
	right: ReadonlyMap<string, ProviderListing>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [providerId, listing] of left) {
		const other = right.get(providerId);
		if (!other || other.baseUrl !== listing.baseUrl || other.ids.size !== listing.ids.size)
			return false;
		for (const id of listing.ids) if (!other.ids.has(id)) return false;
	}
	return true;
}
