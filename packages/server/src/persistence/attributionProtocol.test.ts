import { expect, test } from "bun:test";
import { parseAcquisitionRecord, parseRedeemedAttribution } from "./attributionProtocol";

const now = Date.now();
const touch = {
	source: "newsletter",
	medium: "email",
	campaign: "launch",
	content: "hero",
	referrer_class: "referral",
	landing_content_key: "landing",
	touched_at: now - 1_000,
	policy_version: 1,
} as const;
const redeemed = {
	journey_id: "123e4567-e89b-42d3-a456-426614174000",
	bridge_id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	first_touch: touch,
	last_touch: { ...touch, touched_at: now },
};

test("the mirrored acquisition protocol accepts only its closed normalized schema", () => {
	expect(parseRedeemedAttribution(redeemed, now)).toEqual(redeemed);
	for (const invalid of [
		{ ...redeemed, unknown: true },
		{ ...redeemed, journey_id: "not-a-journey" },
		{ ...redeemed, bridge_id: "not-a-bridge" },
		{ ...redeemed, first_touch: { ...touch, unknown: true } },
		{ ...redeemed, first_touch: { ...touch, source: " newsletter" } },
		{ ...redeemed, first_touch: { ...touch, source: "x".repeat(65) } },
		{ ...redeemed, first_touch: { ...touch, campaign: "x".repeat(129) } },
		{ ...redeemed, first_touch: { ...touch, referrer_class: "advertising" } },
		{ ...redeemed, first_touch: { ...touch, landing_content_key: "/private" } },
		{ ...redeemed, first_touch: { ...touch, touched_at: now + 60_001 } },
		{ ...redeemed, first_touch: { ...touch, policy_version: 2 } },
		{ ...redeemed, first_touch: { ...touch, touched_at: now + 1 } },
	]) {
		expect(parseRedeemedAttribution(invalid, now)).toBeUndefined();
	}
});

test("campaign values are Unicode-code-point bounded and optional without widening the schema", () => {
	const bounded = "🛤".repeat(64);
	const record = {
		first_touch: { ...touch, source: bounded },
		last_touch: {
			referrer_class: "direct" as const,
			landing_content_key: "agentic-development" as const,
			touched_at: now,
			policy_version: 1 as const,
		},
	};
	expect(parseAcquisitionRecord(record, now)).toEqual(record);
	expect(
		parseAcquisitionRecord(
			{ ...record, first_touch: { ...record.first_touch, source: `${bounded}x` } },
			now,
		),
	).toBeUndefined();
});
