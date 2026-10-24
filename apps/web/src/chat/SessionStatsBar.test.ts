import { describe, expect, it } from "bun:test";
import type { SessionStats } from "@thinkrail/contracts";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	contextPart,
	formatElapsed,
	formatTokens,
	SessionStatsBar,
	usageParts,
} from "./SessionStatsBar";

function stats(overrides: Partial<SessionStats> = {}): SessionStats {
	return {
		sessionId: "session-1",
		totalMessages: 1,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		cost: 0,
		...overrides,
	};
}

describe("SessionStatsBar pi-style formatting", () => {
	it("matches pi's compact token thresholds", () => {
		expect([999, 1_200, 12_345, 1_200_000, 10_400_000].map(formatTokens)).toEqual([
			"999",
			"1.2k",
			"12k",
			"1.2M",
			"10M",
		]);
	});

	it("switches units by the rounded value so no label reads 10.0k or 1000k", () => {
		expect(
			[9_949, 9_950, 9_999, 999_499, 999_500, 999_999, 9_949_999, 9_950_000].map(formatTokens),
		).toEqual(["9.9k", "10k", "10k", "999k", "1.0M", "1.0M", "9.9M", "10M"]);
	});

	it("orders the available pi fields and omits zero values", () => {
		expect(
			usageParts(
				stats({
					tokens: {
						input: 12_345,
						output: 342,
						cacheRead: 10_400_000,
						cacheWrite: 83_000,
						total: 10_495_687,
					},
					cost: 6.85,
				}),
			),
		).toEqual(["↑12k", "↓342", "R10M", "W83k", "$6.850"]);
		expect(usageParts(stats())).toEqual([]);
	});

	it("renders the approved five-cell context bar and pi-style context label", () => {
		expect(contextPart({ tokens: 120_000, contextWindow: 200_000, percent: 60 })).toEqual({
			bar: "▰▰▰▱▱",
			text: "60.0%/200k",
		});
		expect(contextPart({ tokens: null, contextWindow: 200_000, percent: null })).toEqual({
			bar: "▱▱▱▱▱",
			text: "?/200k",
		});
	});

	it("separates fields with middle dots and keeps the compact header line unwrapped", () => {
		const value = stats({
			tokens: { input: 12_345, output: 342, cacheRead: 0, cacheWrite: 0, total: 12_687 },
			cost: 0.125,
			contextUsage: { tokens: 120_000, contextWindow: 200_000, percent: 60 },
		});
		const markup = renderToStaticMarkup(createElement(SessionStatsBar, { stats: value }));
		expect(markup.replace(/<[^>]+>/g, "")).toBe("↑12k·↓342·$0.125·▰▰▰▱▱60.0%/200k");
		expect(markup).toContain("flex-nowrap");
		expect(markup.match(/whitespace-nowrap/g)).toHaveLength(4);
	});
});

it("formats a turn's elapsed time with the interface language's units", () => {
	expect(formatElapsed(currentTranslator(), 5_000)).toBe("5s");
	expect(formatElapsed(currentTranslator(), 65_000)).toBe("1m 5s");
	applyLocale("ru", { ru: { "chat.elapsed.minutesSeconds": "{{minutes}} мин {{seconds}} с" } });
	try {
		expect(formatElapsed(currentTranslator(), 65_000)).toBe("1 мин 5 с");
	} finally {
		applyLocale("en", {});
	}
});
