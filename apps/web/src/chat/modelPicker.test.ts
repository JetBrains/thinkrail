import { describe, expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import {
	billsPerToken,
	costLabel,
	describeAuth,
	formatContext,
	formatPrice,
	groupByProvider,
	kindLabel,
	litBars,
	trailingLevel,
} from "./modelPicker";

const model = (overrides: Partial<WireModel> & Pick<WireModel, "id">): WireModel => ({
	name: overrides.id,
	provider: "anthropic",
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["off", "low", "medium", "high"],
	...overrides,
});

describe("formatting", () => {
	test("context windows collapse to K/M", () => {
		expect(formatContext(200_000)).toBe("200K");
		expect(formatContext(1_000_000)).toBe("1M");
		expect(formatContext(1_050_000)).toBe("1.1M");
		expect(formatContext(512)).toBe("512");
	});

	test("prices keep cents below $10 and drop them above", () => {
		expect(formatPrice(2.5)).toBe("$2.5");
		expect(formatPrice(0.4)).toBe("$0.4");
		expect(formatPrice(25)).toBe("$25");
		expect(formatPrice(12.4)).toBe("$12");
	});
});

describe("costLabel / kindLabel", () => {
	test("quotes list prices only where the provider bills per token", () => {
		const cost = { input: 5, output: 25 };
		expect(costLabel(model({ id: "m", cost, auth: { kind: "api-key" } }))).toBe("$5 / $25");
		expect(costLabel(model({ id: "m", cost, auth: { kind: "env" } }))).toBe("$5 / $25");
		expect(costLabel(model({ id: "m", cost, auth: { kind: "oauth" } }))).toBeNull();
		expect(costLabel(model({ id: "m", cost, auth: { kind: "central" } }))).toBeNull();
		expect(costLabel(model({ id: "m", cost }))).toBe("$5 / $25");
		expect(costLabel(model({ id: "m" }))).toBeNull();
		expect(billsPerToken("oauth")).toBe(false);
		expect(billsPerToken(undefined)).toBe(false);
	});

	test("names what the model draws on: plan, quota, the env variable, or the key", () => {
		expect(kindLabel(model({ id: "m", auth: { kind: "oauth" } }))).toBe("plan");
		expect(kindLabel(model({ id: "m", auth: { kind: "oauth", detail: "Pro/Max" } }))).toBe(
			"Pro/Max",
		);
		expect(kindLabel(model({ id: "m", auth: { kind: "central" } }))).toBe("quota");
		expect(kindLabel(model({ id: "m", auth: { kind: "env", detail: "X_KEY" } }))).toBe("X_KEY");
		expect(kindLabel(model({ id: "m", auth: { kind: "api-key" } }))).toBe("API key");
		expect(kindLabel(model({ id: "m", auth: { kind: "other" } }))).toBeNull();
		expect(kindLabel(model({ id: "m" }))).toBeNull();
	});
});

describe("litBars", () => {
	test("scales the level's rank among reasoning levels onto the bars, with off dark", () => {
		const six = ["off", "low", "medium", "high", "xhigh", "max"] as const;
		expect(six.map((l) => litBars(l, six))).toEqual([0, 1, 2, 2, 3, 4]);
		const three = ["low", "high", "max"] as const;
		expect(three.map((l) => litBars(l, three))).toEqual([1, 3, 4]);
		expect(litBars("high", ["off"])).toBe(0);
	});
});

describe("describeAuth", () => {
	test("spells out the kind and appends pi's detail", () => {
		expect(describeAuth(model({ id: "m" }))).toBeNull();
		expect(describeAuth(model({ id: "m", auth: { kind: "oauth" } }))).toBe("subscription");
		expect(describeAuth(model({ id: "m", auth: { kind: "env", detail: "X_KEY" } }))).toBe(
			"environment key · X_KEY",
		);
	});
});

describe("groupByProvider", () => {
	test("keeps catalog order and lifts the first known auth per provider", () => {
		const groups = groupByProvider([
			model({ id: "a", provider: "openai" }),
			model({ id: "b", provider: "anthropic", auth: { kind: "oauth" } }),
			model({ id: "c", provider: "openai", auth: { kind: "api-key", detail: "OPENAI_API_KEY" } }),
		]);
		expect(groups.map((g) => [g.provider, g.models.map((m) => m.id), g.auth])).toEqual([
			["openai", ["a", "c"], "API key · OPENAI_API_KEY"],
			["anthropic", ["b"], "subscription"],
		]);
	});
});

describe("trailingLevel", () => {
	const opus = model({ id: "opus" });
	test("reads a trailing level the highlighted model supports", () => {
		expect(trailingLevel("opus high", opus)).toBe("high");
		expect(trailingLevel("  opus   MEDIUM ", opus)).toBe("medium");
	});
	test("ignores single words, unsupported levels, and missing models", () => {
		expect(trailingLevel("high", opus)).toBeNull();
		expect(trailingLevel("opus xhigh", opus)).toBeNull();
		expect(trailingLevel("opus max", null)).toBeNull();
		expect(trailingLevel("", opus)).toBeNull();
	});
});
