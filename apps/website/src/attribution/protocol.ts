export const attributionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const attributionPolicyVersion = 1 as const;
export const bridgeIdPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const journeyIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const referrerClasses = ["direct", "internal", "search", "social", "referral"] as const;
export type ReferrerClass = (typeof referrerClasses)[number];

export const attributionContentKeys = [
	"landing",
	"blog/index",
	"blog/introducing-thinkrail",
	"blog/thinkrail-workspaces",
	"blog/thinkrail-sdd",
	"vibecoding",
	"agentic-development",
] as const;
export type AttributionContentKey = (typeof attributionContentKeys)[number];

export type AttributionTouch = {
	source?: string;
	medium?: string;
	campaign?: string;
	content?: string;
	referrer_class: ReferrerClass;
	landing_content_key: AttributionContentKey;
	touched_at: number;
	policy_version: typeof attributionPolicyVersion;
};

export type AttributionContext = {
	bridge_id?: string;
	first_touch: AttributionTouch;
	last_touch: AttributionTouch;
};

const campaignBounds = {
	source: 64,
	medium: 64,
	campaign: 128,
	content: 128,
} as const;
const referrerClassSet = new Set<string>(referrerClasses);
const contentKeySet = new Set<string>(attributionContentKeys);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function normalizeCampaignValue(value: string, limit: number): string | undefined {
	const withoutControls = Array.from(value)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 31 && (codePoint < 127 || codePoint > 159);
		})
		.join("");
	const normalized = Array.from(withoutControls.trim()).slice(0, limit).join("");
	return normalized.length > 0 ? normalized : undefined;
}

function optionalNormalizedString(
	value: Record<string, unknown>,
	key: keyof typeof campaignBounds,
): string | undefined | false {
	const candidate = value[key];
	if (candidate === undefined) return undefined;
	if (typeof candidate !== "string") return false;
	const normalized = normalizeCampaignValue(candidate, campaignBounds[key]);
	return normalized === candidate ? candidate : false;
}

export function parseAttributionTouch(value: unknown, now: number): AttributionTouch | undefined {
	if (!isRecord(value)) return undefined;
	const requiredKeys = ["referrer_class", "landing_content_key", "touched_at", "policy_version"];
	const allowedKeys = [...requiredKeys, ...Object.keys(campaignBounds)];
	if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return undefined;
	if (requiredKeys.some((key) => !Object.hasOwn(value, key))) return undefined;

	const source = optionalNormalizedString(value, "source");
	const medium = optionalNormalizedString(value, "medium");
	const campaign = optionalNormalizedString(value, "campaign");
	const content = optionalNormalizedString(value, "content");
	if (source === false || medium === false || campaign === false || content === false) {
		return undefined;
	}
	if (typeof value.referrer_class !== "string" || !referrerClassSet.has(value.referrer_class)) {
		return undefined;
	}
	if (
		typeof value.landing_content_key !== "string" ||
		!contentKeySet.has(value.landing_content_key)
	) {
		return undefined;
	}
	if (
		typeof value.touched_at !== "number" ||
		!Number.isSafeInteger(value.touched_at) ||
		value.touched_at < now - attributionLifetimeMs ||
		value.touched_at > now + 60_000 ||
		value.policy_version !== attributionPolicyVersion
	) {
		return undefined;
	}

	return {
		...(source === undefined ? {} : { source }),
		...(medium === undefined ? {} : { medium }),
		...(campaign === undefined ? {} : { campaign }),
		...(content === undefined ? {} : { content }),
		referrer_class: value.referrer_class as ReferrerClass,
		landing_content_key: value.landing_content_key as AttributionContentKey,
		touched_at: value.touched_at,
		policy_version: attributionPolicyVersion,
	};
}

export function parseAttributionContext(
	value: unknown,
	now: number,
): AttributionContext | undefined {
	if (!isRecord(value)) return undefined;
	const hasBridgeId = Object.hasOwn(value, "bridge_id");
	if (!hasExactKeys(value, [...(hasBridgeId ? ["bridge_id"] : []), "first_touch", "last_touch"])) {
		return undefined;
	}
	if (
		hasBridgeId &&
		(typeof value.bridge_id !== "string" || !bridgeIdPattern.test(value.bridge_id))
	) {
		return undefined;
	}
	const firstTouch = parseAttributionTouch(value.first_touch, now);
	const lastTouch = parseAttributionTouch(value.last_touch, now);
	if (firstTouch === undefined || lastTouch === undefined) return undefined;
	if (firstTouch.touched_at > lastTouch.touched_at) return undefined;
	return {
		...(hasBridgeId ? { bridge_id: value.bridge_id as string } : {}),
		first_touch: firstTouch,
		last_touch: lastTouch,
	};
}
