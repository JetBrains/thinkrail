import { describe, expect, test } from "bun:test";
import {
	DEFAULT_LIST_VIEW,
	DEFAULT_STATS_VIEW,
	type ListViewState,
	readListViewState,
	showTab,
	withListIntent,
} from "./viewState";

const PICK = {
	sessionId: "s1",
	title: "Fix the parser",
	firstPrompt: null,
	start: 1_700_000_000_000,
	calls: 9,
	labels: ["good"],
};

const SAVED: ListViewState = {
	tab: "insights",
	results: true,
	search: "tool:bash",
	scope: "all",
	sort: { key: "cost", direction: "asc" },
	toggled: ["project:p2"],
	label: "good",
	filter: { label: "Cache misses", ids: ["s1", "s2"] },
	picks: [PICK],
	stats: {
		section: "ab",
		hotspotSort: "changes",
		hotspotLayout: "tree",
		usage: { metric: "tokens", by: "project", withOutside: false, tab: "skills" },
		sequences: "errors",
		slices: { by: "label", a: "good", b: "" },
	},
};

describe("the list's saved view", () => {
	test("reads back what it saved", () => {
		expect(readListViewState(JSON.parse(JSON.stringify(SAVED)))).toEqual(SAVED);
	});

	test("nothing saved, or not an object, is today's view", () => {
		for (const value of [undefined, null, 3, "insights", []])
			expect(readListViewState(value)).toEqual(DEFAULT_LIST_VIEW);
		expect(DEFAULT_LIST_VIEW.tab).toBe("sessions");
		expect(DEFAULT_LIST_VIEW.stats.section).toBe("findings");
	});

	test("a field of the wrong shape falls back alone; the others stay", () => {
		const read = readListViewState({
			...SAVED,
			tab: "statistics",
			scope: 7,
			sort: { key: "price", direction: "asc" },
			toggled: ["project:p2", 4],
			filter: { label: "x" },
			picks: [PICK, { title: "no id" }, { sessionId: "s2", labels: "bad", start: "soon" }],
			stats: {
				...SAVED.stats,
				section: "compare",
				usage: { metric: "money", by: "project", withOutside: "yes", tab: "skills" },
				slices: { by: "colour", a: 3, b: "x" },
			},
		});
		expect(read.tab).toBe("sessions");
		expect(read.scope).toBe("project");
		expect(read.sort).toEqual({ key: "start", direction: "asc" });
		expect(read.toggled).toEqual(["project:p2"]);
		expect(read.filter).toBeNull();
		expect(read.search).toBe("tool:bash");
		expect(read.picks).toEqual([
			PICK,
			{ sessionId: "s2", title: null, firstPrompt: null, start: null, calls: null, labels: [] },
		]);
		expect(read.stats.section).toBe("findings");
		expect(read.stats.hotspotLayout).toBe("tree");
		expect(read.stats.usage).toEqual({
			metric: null,
			by: "project",
			withOutside: true,
			tab: "skills",
		});
		expect(read.stats.slices).toEqual({ by: "model", a: null, b: "x" });
	});

	test("search results come back only with something to search", () => {
		expect(readListViewState({ results: true, search: "  " }).results).toBe(false);
		expect(readListViewState({ results: true, search: "lint" }).results).toBe(true);
	});
});

describe("switching the list's tab", () => {
	test("closes the search; the table's filters stay only on Sessions; ticks always stay", () => {
		const days = showTab(SAVED, "days");
		expect(days.tab).toBe("days");
		expect(days.results).toBe(false);
		expect(days.search).toBe("");
		expect(days.label).toBeNull();
		expect(days.filter).toBeNull();
		expect(days.picks).toEqual([PICK]);
		const sessions = showTab(SAVED, "sessions");
		expect(sessions.label).toBe("good");
		expect(sessions.filter).toEqual(SAVED.filter);
	});

	test("another panel's request shows its tab and Insights section, or keeps the section", () => {
		const findings = withListIntent(DEFAULT_LIST_VIEW, { tab: "insights", section: "sequences" });
		expect(findings.tab).toBe("insights");
		expect(findings.stats).toEqual({ ...DEFAULT_STATS_VIEW, section: "sequences" });
		const kept = withListIntent(SAVED, { tab: "insights" });
		expect(kept.stats.section).toBe("ab");
		expect(kept.scope).toBe(SAVED.scope);
		expect(withListIntent(DEFAULT_LIST_VIEW, { tab: "insights", scope: "all" }).scope).toBe("all");
		expect(kept.results).toBe(false);
		expect(kept.picks).toEqual([PICK]);
	});
});
