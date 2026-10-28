import { describe, expect, test } from "bun:test";
import { RiChat2Line } from "@remixicon/react";
import { MATCH_TIER, type SearchGroup } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { type Arrivals, NO_ARRIVALS, noteArrivals, withPinned } from "./arrivals";
import { hostItems } from "./hostItems";
import { mergeHostGroups } from "./hostSearch";
import { EMPTY_LEARNING } from "./learning";
import type { PaletteItem } from "./model";
import { parseSearchQuery } from "./query";
import { buildSections, flattenRows } from "./sections";

describe("noteArrivals", () => {
	test("nothing is late without a selection, and rows already on screen never become late", () => {
		expect(noteArrivals(NO_ARRIVALS, ["a", "b"], new Set(), false)).toBe(NO_ARRIVALS);
		const first = noteArrivals(NO_ARRIVALS, ["a", "b"], new Set(["a"]), true);
		expect([...first.late]).toEqual([["b", 1]]);
		const second = noteArrivals(first, ["a", "b", "c"], new Set(["a", "b"]), true);
		expect([...second.late]).toEqual([
			["b", 1],
			["c", 2],
		]);
		expect(noteArrivals(second, ["b", "c"], new Set(), true)).toBe(second);
	});
});

describe("withPinned", () => {
	const item = (id: string): PaletteItem => ({
		id,
		kind: "file",
		title: id,
		group: "files",
		scope: "files",
		icon: RiChat2Line,
	});
	const input = (workspaceId: string) => ({
		enabled: true,
		text: "refresh",
		kinds: ["file" as const],
		context: { projectId: "p1", workspaceId },
	});
	const pinned = { item: item("file:w1:a.ts"), input: input("w1") };

	test("the selected host row stays while the same search stands, never in another root's results", () => {
		expect(withPinned([item("file:w1:b.ts")], pinned, input("w1")).map((row) => row.id)).toEqual([
			"file:w1:b.ts",
			"file:w1:a.ts",
		]);
		const listed = [item("file:w1:a.ts")];
		expect(withPinned(listed, pinned, input("w1"))).toBe(listed);
		expect(withPinned([], pinned, input("w2"))).toEqual([]);
		expect(withPinned([], pinned, { ...input("w1"), enabled: false })).toEqual([]);
		expect(withPinned([], null, input("w1"))).toEqual([]);
	});
});

describe("selection stability across host replies", () => {
	const t = currentTranslator();
	const local: PaletteItem = {
		id: "chat:local",
		kind: "chat",
		title: "Refresh notes",
		group: "chats",
		scope: "work",
		icon: RiChat2Line,
	};
	const files = (
		state: SearchGroup["state"],
		tier: number,
		names: readonly string[],
	): SearchGroup => ({
		kind: "file",
		state,
		total: names.length,
		hits: names.map((name) => ({
			id: `file:p1:w1:${name}`,
			kind: "file",
			title: name,
			path: name,
			tier,
			score: 1,
			projectId: "p1",
			workspaceId: "w1",
		})),
	});
	const rowsOf = (groups: readonly SearchGroup[], arrivals: Arrivals) => {
		const items = hostItems(
			{
				t,
				openHit: () => {},
				projectName: () => "One",
				workspaceName: () => undefined,
				localIds: new Set([local.id]),
				late: arrivals.late,
				stale: false,
			},
			groups,
		);
		return flattenRows(
			buildSections({
				t,
				parsed: parseSearchQuery("refresh"),
				rootItems: [local, ...items],
				waiting: [],
				actions: [],
				expanded: new Set(),
				learning: EMPTY_LEARNING,
				nowMs: 0,
			}),
		).map((row) => row.item.id);
	};

	test("a better page that lands after the user selected a file keeps that file and every row above it in place", () => {
		let shown: SearchGroup[] | null = null;
		let arrivals = NO_ARRIVALS;
		let onScreen = new Set<string>(rowsOf([], arrivals));
		const land = (reply: SearchGroup[], holdingSelection: boolean) => {
			shown = mergeHostGroups(shown, reply);
			arrivals = noteArrivals(
				arrivals,
				shown.flatMap((group) => group.hits.map((hit) => hit.id)),
				onScreen,
				holdingSelection,
			);
			const rows = rowsOf(shown, arrivals);
			onScreen = new Set(rows);
			return rows;
		};

		const stale = ["a-refresh.ts", "b-refresh.ts", "c-refresh.ts", "d-refresh.ts"];
		const first = land([files("indexing", MATCH_TIER.substring, stale)], true);
		const selected = "file:p1:w1:b-refresh.ts";
		const above = first.slice(0, first.indexOf(selected) + 1);

		const better = ["refresh-1.ts", "refresh-2.ts", "refresh-3.ts", "refresh-4.ts"];
		const second = land([files("ready", MATCH_TIER.prefix, better)], true);
		expect(second.slice(0, above.length)).toEqual(above);
		expect(second).toContain(selected);
	});
});
