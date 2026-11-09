import { describe, expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	type GroupExpansion,
	groupRowValue,
	initialGroupExpansion,
	pickerEmptyState,
	pickerFilter,
	pickerGroups,
	rowValue,
	type SearchRow,
	searchScore,
	toggleGroup,
} from "./pickerGroups";

const model = (provider: string, id: string, name = id): WireModel => ({
	provider,
	id,
	name,
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["off", "high"],
});

const opus = model("anthropic", "claude-opus-4", "Claude Opus 4");
const sonnet = model("anthropic", "claude-sonnet-4", "Claude Sonnet 4");
const gpt = model("openai", "gpt-5", "GPT-5");
const o3 = model("openai", "o3", "o3");
const catalog = [opus, sonnet, gpt, o3];

const row = (m: WireModel): SearchRow => ({
	value: rowValue("all", m),
	keywords: [m.name, m.id, m.provider, ...m.thinkingLevels],
});

const collapsed: GroupExpansion = initialGroupExpansion(null, []);

function groups(query: string, expansion = collapsed, pinned: WireModel[] = []) {
	return pickerGroups(currentTranslator(), catalog, { pinned, query, expansion, row }).map((g) => ({
		provider: g.provider,
		count: g.count,
		expanded: g.expanded,
		models: g.models.map((m) => m.id),
	}));
}

describe("searchScore", () => {
	test("matches fuzzy subsequences across value and keywords", () => {
		expect(searchScore("all:anthropic:claude-opus-4", "opus high", ["high"])).toBeGreaterThan(0);
		expect(searchScore("all:openai:o3", "zzz", ["o3"])).toBe(0);
	});

	test("ranks a prefix above a scattered match", () => {
		expect(searchScore("gpt-5", "gpt")).toBeGreaterThan(searchScore("a-g-p-t", "gpt"));
	});
});

describe("pickerGroups", () => {
	test("every group starts collapsed with its full count when nothing is selected", () => {
		expect(groups("")).toEqual([
			{
				provider: "anthropic",
				count: 2,
				expanded: false,
				models: ["claude-opus-4", "claude-sonnet-4"],
			},
			{ provider: "openai", count: 2, expanded: false, models: ["gpt-5", "o3"] },
		]);
	});

	test("the selected model's group starts expanded", () => {
		const expansion = initialGroupExpansion(gpt, []);
		expect(groups("", expansion).map((g) => [g.provider, g.expanded])).toEqual([
			["anthropic", false],
			["openai", true],
		]);
	});

	test("a pinned selection expands nothing because Pinned already shows it", () => {
		const expansion = initialGroupExpansion(gpt, [gpt]);
		expect(groups("", expansion, [gpt]).map((g) => g.expanded)).toEqual([false, false]);
	});

	test("pinned models are not repeated inside provider groups", () => {
		expect(groups("", collapsed, [gpt, o3]).map((g) => g.provider)).toEqual(["anthropic"]);
		expect(groups("", collapsed, [gpt])[1]).toMatchObject({ count: 1, models: ["o3"] });
	});

	test("searching expands groups, shows filtered counts and drops groups with no match", () => {
		expect(groups("sonnet")).toEqual([
			{
				provider: "anthropic",
				count: 1,
				expanded: true,
				models: ["claude-opus-4", "claude-sonnet-4"],
			},
		]);
		expect(groups("zzz")).toEqual([]);
	});

	test("a header toggles browse and search expansion independently", () => {
		const browsing = toggleGroup(collapsed, "openai", false);
		expect(groups("", browsing).map((g) => g.expanded)).toEqual([false, true]);
		expect(groups("claude", browsing).map((g) => g.expanded)).toEqual([true]);

		const searching = toggleGroup(browsing, "anthropic", true);
		expect(groups("claude", searching).map((g) => g.expanded)).toEqual([false]);
		expect(groups("", searching).map((g) => g.expanded)).toEqual([false, true]);
		expect(groups("", toggleGroup(searching, "openai", false)).map((g) => g.expanded)).toEqual([
			false,
			false,
		]);
	});
});

describe("pickerFilter", () => {
	const visible = pickerGroups(currentTranslator(), catalog, {
		pinned: [],
		query: "",
		expansion: collapsed,
		row,
	});
	const filter = pickerFilter(visible, row);

	test("scores model rows like the default scorer", () => {
		const r = row(gpt);
		expect(filter(r.value, "gpt", [...r.keywords])).toBe(searchScore(r.value, "gpt", r.keywords));
	});

	test("a header outranks its best model so it stays first, and hides when nothing matches", () => {
		const header = filter(groupRowValue("openai"), "gpt", []);
		const best = Math.max(
			...[gpt, o3].map((m) => searchScore(row(m).value, "gpt", row(m).keywords)),
		);
		expect(header).toBeGreaterThan(best);
		expect(filter(groupRowValue("openai"), "sonnet", [])).toBe(0);
		expect(filter(groupRowValue("missing"), "gpt", [])).toBe(0);
	});
});

describe("pickerEmptyState", () => {
	test('"No models found." only for a typed query', () => {
		expect(pickerEmptyState("", 4)).toBeNull();
		expect(pickerEmptyState("x", 4)).toBe("no-match");
		expect(pickerEmptyState("x", 0)).toBe("no-match");
	});

	test("an empty list without a query shows the hint instead", () => {
		expect(pickerEmptyState("", 0)).toBe("no-models");
	});
});
