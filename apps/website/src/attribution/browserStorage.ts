import {
	type AttributionContentKey,
	type AttributionContext,
	type AttributionTouch,
	attributionLifetimeMs,
	attributionPolicyVersion,
	bridgeIdPattern,
	hasExactKeys,
	journeyIdPattern,
	normalizeCampaignValue,
	parseAttributionContext,
	type ReferrerClass,
} from "./protocol";

const storageKey = "thinkrail_attribution_context_v1";
const searchHosts = ["google.com", "bing.com", "duckduckgo.com", "search.yahoo.com"];
const socialHosts = [
	"linkedin.com",
	"twitter.com",
	"x.com",
	"facebook.com",
	"instagram.com",
	"reddit.com",
	"youtube.com",
];

export type AttributionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredAttributionContext = AttributionContext & {
	journey_id: string;
};

export type BridgeIdGenerator = () => string | undefined;

function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifyReferrer(referrer: string): ReferrerClass {
	if (referrer === "") return "direct";
	let hostname: string;
	try {
		hostname = new URL(referrer).hostname.toLowerCase();
	} catch {
		return "referral";
	}
	if (hostname === "thinkrail.ai") return "internal";
	if (searchHosts.some((domain) => domainMatches(hostname, domain))) return "search";
	if (socialHosts.some((domain) => domainMatches(hostname, domain))) return "social";
	return "referral";
}

function normalizedParameter(url: URL, name: string, limit: number): string | undefined {
	const raw = url.searchParams.get(name);
	if (raw === null) return undefined;
	return normalizeCampaignValue(raw, limit);
}

export function touchFromNavigation(
	href: string,
	referrer: string,
	contentKey: AttributionContentKey,
	now: number,
): AttributionTouch | undefined {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return undefined;
	}
	const source = normalizedParameter(url, "utm_source", 64);
	const medium = normalizedParameter(url, "utm_medium", 64);
	const campaign = normalizedParameter(url, "utm_campaign", 128);
	const content = normalizedParameter(url, "utm_content", 128);
	return {
		...(source === undefined ? {} : { source }),
		...(medium === undefined ? {} : { medium }),
		...(campaign === undefined ? {} : { campaign }),
		...(content === undefined ? {} : { content }),
		referrer_class: classifyReferrer(referrer),
		landing_content_key: contentKey,
		touched_at: now,
		policy_version: attributionPolicyVersion,
	};
}

function parseStoredContext(
	value: unknown,
	now: number,
	expectedJourneyId?: string,
): StoredAttributionContext | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	const hasBridgeId = Object.hasOwn(candidate, "bridge_id");
	if (
		!hasExactKeys(candidate, [
			...(hasBridgeId ? ["bridge_id"] : []),
			"journey_id",
			"first_touch",
			"last_touch",
		])
	) {
		return undefined;
	}
	if (typeof candidate.journey_id !== "string" || !journeyIdPattern.test(candidate.journey_id)) {
		return undefined;
	}
	if (expectedJourneyId !== undefined && candidate.journey_id !== expectedJourneyId)
		return undefined;
	const context = parseAttributionContext(
		{
			...(hasBridgeId ? { bridge_id: candidate.bridge_id } : {}),
			first_touch: candidate.first_touch,
			last_touch: candidate.last_touch,
		},
		now,
	);
	return context === undefined ? undefined : { journey_id: candidate.journey_id, ...context };
}

function hasCampaignParameter(href: string): boolean {
	try {
		const parameters = new URL(href).searchParams;
		return ["utm_source", "utm_medium", "utm_campaign", "utm_content"].some((name) =>
			parameters.has(name),
		);
	} catch {
		return false;
	}
}

export function recordAttributionTouch(
	journeyId: string,
	contentKey: AttributionContentKey,
	href: string,
	referrer: string,
	storage: AttributionStorage,
	now = Date.now(),
): AttributionContext | undefined {
	if (!journeyIdPattern.test(journeyId)) return undefined;
	const touch = touchFromNavigation(href, referrer, contentKey, now);
	if (touch === undefined) return undefined;
	try {
		let existing: StoredAttributionContext | undefined;
		const raw = storage.getItem(storageKey);
		if (raw !== null) {
			try {
				existing = parseStoredContext(JSON.parse(raw), now, journeyId);
			} catch {}
		}
		const updateLast =
			existing === undefined ||
			hasCampaignParameter(href) ||
			touch.referrer_class === "search" ||
			touch.referrer_class === "social" ||
			touch.referrer_class === "referral";
		const context: StoredAttributionContext = {
			journey_id: journeyId,
			...(existing?.bridge_id === undefined ? {} : { bridge_id: existing.bridge_id }),
			first_touch: existing?.first_touch ?? touch,
			last_touch: updateLast ? touch : (existing?.last_touch ?? touch),
		};
		storage.setItem(storageKey, JSON.stringify(context));
		return {
			...(context.bridge_id === undefined ? {} : { bridge_id: context.bridge_id }),
			first_touch: context.first_touch,
			last_touch: context.last_touch,
		};
	} catch {
		return undefined;
	}
}

export function readAttributionContext(
	journeyId: string | undefined,
	storage: AttributionStorage,
	now = Date.now(),
): AttributionContext | undefined {
	if (journeyId === undefined || !journeyIdPattern.test(journeyId)) return undefined;
	try {
		const raw = storage.getItem(storageKey);
		if (raw === null) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			storage.removeItem(storageKey);
			return undefined;
		}
		const context = parseStoredContext(parsed, now, journeyId);
		if (context === undefined || now - context.last_touch.touched_at > attributionLifetimeMs) {
			storage.removeItem(storageKey);
			return undefined;
		}
		return {
			...(context.bridge_id === undefined ? {} : { bridge_id: context.bridge_id }),
			first_touch: context.first_touch,
			last_touch: context.last_touch,
		};
	} catch {
		return undefined;
	}
}

export function createBridgeId(): string | undefined {
	try {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const bridgeId = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		return bridgeIdPattern.test(bridgeId) ? bridgeId : undefined;
	} catch {
		return undefined;
	}
}

export function storeLatestAttributionBridge(
	journeyId: string,
	storage: AttributionStorage,
	generateBridgeId: BridgeIdGenerator = createBridgeId,
	now = Date.now(),
): string | undefined {
	if (!journeyIdPattern.test(journeyId)) return undefined;
	try {
		const raw = storage.getItem(storageKey);
		if (raw === null) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			storage.removeItem(storageKey);
			return undefined;
		}
		const context = parseStoredContext(parsed, now, journeyId);
		if (context === undefined || now - context.last_touch.touched_at > attributionLifetimeMs) {
			storage.removeItem(storageKey);
			return undefined;
		}
		const bridgeId = generateBridgeId();
		if (bridgeId === undefined || !bridgeIdPattern.test(bridgeId)) return undefined;
		storage.setItem(storageKey, JSON.stringify({ ...context, bridge_id: bridgeId }));
		return bridgeId;
	} catch {
		return undefined;
	}
}

export function readStoredAttributionContext(
	storage: AttributionStorage,
	now = Date.now(),
): StoredAttributionContext | undefined {
	try {
		const raw = storage.getItem(storageKey);
		if (raw === null) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			storage.removeItem(storageKey);
			return undefined;
		}
		const context = parseStoredContext(parsed, now);
		if (context === undefined || now - context.last_touch.touched_at > attributionLifetimeMs) {
			storage.removeItem(storageKey);
			return undefined;
		}
		return context;
	} catch {
		return undefined;
	}
}

export function clearAttributionContext(storage: AttributionStorage): void {
	try {
		storage.removeItem(storageKey);
	} catch {}
}

export const attributionStorageKey = storageKey;
