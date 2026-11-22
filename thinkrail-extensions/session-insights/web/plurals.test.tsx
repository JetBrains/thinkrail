import { describe, expect, test } from "bun:test";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import { findingsSummary } from "./stats/FindingsBadge";

const tally = (error: number, warning: number, info: number) => ({
	error,
	warning,
	info,
	total: error + warning + info,
});

describe("counts agree with their number", () => {
	test("in English, one reads singular", () => {
		const t = currentTranslator();
		expect(t("sessionInsights.selection.count", { count: 1 })).toBe("1 session selected");
		expect(findingsSummary(t, tally(0, 1, 0))).toBe("1 finding · 1 warning");
		expect(
			t("sessionInsights.findings.rule.commandFailing.why", {
				count: 1,
				countText: "1",
				total: "1",
				share: "100%",
				low: "21%",
				high: "100%",
				inSessions: "in 1 session",
				exits: "exit 1 ×1",
			}),
		).toStartWith("Failed in 1 of 1 run (");
		expect(t("sessionInsights.findings.quoteCount", { count: 1, quoted: "1", total: "1" })).toBe(
			"in 1 of 1 failure",
		);
		expect(t("sessionInsights.hotspots.inSessions", { count: 1, n: "1" })).toBe("in 1 session");
		expect(t("sessionInsights.sequences.scopeCalls", { count: 1, n: "1" })).toBe("1 call");
		expect(
			t("sessionInsights.search.scanning", {
				count: 1,
				summary: "2 events",
				read: "0",
				total: "1",
			}),
		).toBe("Searching… 2 events so far · read 0 of 1 session");
		expect(t("sessionInsights.compare.pairs", { count: 1 })).toBe("1 pair");
	});

	test("in Russian, one, few and many read their own forms", async () => {
		await applyLocale("ru", {});
		try {
			const t = currentTranslator();
			expect(t("sessionInsights.selection.count", { count: 1 })).toBe("Выбрана 1 сессия");
			expect(t("sessionInsights.selection.count", { count: 3 })).toBe("Выбраны 3 сессии");
			expect(t("sessionInsights.selection.count", { count: 5 })).toBe("Выбрано 5 сессий");
			expect(findingsSummary(t, tally(0, 2, 5))).toBe("7 находок · 2 предупреждения, 5 к сведению");
			expect(t("sessionInsights.findings.rule.rework.title", { count: 22, countText: "22" })).toBe(
				"Переделки: файл менялся 22 раза за одну сессию",
			);
			expect(t("sessionInsights.hotspots.scopeFiles", { count: 21, n: "21" })).toBe("21 файл");
			expect(t("sessionInsights.compare.pairs", { count: 4 })).toBe("4 пары");
		} finally {
			await applyLocale("en", {});
		}
	});
});
