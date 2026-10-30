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
		expect(noteArrivals(NO_ARRIVALS, [], new Set(), false)).toBe(NO_ARRIVALS);
		expect(noteArrivals(NO_ARRIVALS, ["a", "b"], new Set(), false).late.size).toBe(0);
		const first = noteArrivals(NO_ARRIVALS, ["a", "b"], new Set(["a"]), true);
		expect([...first.late]).toEqual([["b", 1]]);
		const second = noteArrivals(first, ["a", "b", "c"], new Set(["a", "b"]), true);
		expect([...second.late]).toEqual([
			["b", 1],
			["c", 2],
		]);
		expect(noteArrivals(second, ["a", "b", "c"], new Set(), true)).toBe(second);
		expect(noteArrivals(second, ["b", "c"], new Set(), true).late).toBe(second.late);
	});

	test("a hit the last reply already listed behind a group's cap is no newcomer, one it did not list is", () => {
		const held = noteArrivals(NO_ARRIVALS, ["a", "b", "c"], new Set(["a"]), false);
		const poll = noteArrivals(held, ["a", "b", "c"], new Set(["a"]), true);
		expect(poll.late.size).toBe(0);
		const grown = noteArrivals(poll, ["a", "b", "c", "d"], new Set(["a"]), true);
		expect([...grown.late]).toEqual([["d", 1]]);
		const afterStale = noteArrivals(
			noteArrivals(grown, [], new Set(["a"]), true),
			["a", "b"],
			new Set(["a"]),
			true,
		);
		expect(afterStale.late.get("b")).toBe(2);
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
		const listed = (...ids: string[]) => new Set(ids);
		expect(
			withPinned([item("file:w1:b.ts")], pinned, input("w1"), listed("file:w1:b.ts")).map(
				(row) => row.id,
			),
		).toEqual(["file:w1:b.ts", "file:w1:a.ts"]);
		const shown = [item("file:w1:a.ts")];
		expect(withPinned(shown, pinned, input("w1"), listed("file:w1:a.ts"))).toBe(shown);
		expect(withPinned([], pinned, input("w2"), listed())).toEqual([]);
		expect(withPinned([], pinned, { ...input("w1"), enabled: false }, listed())).toEqual([]);
		expect(withPinned([], null, input("w1"), listed())).toEqual([]);
	});

	test("a local twin that the query misses never takes the pinned host row's place", () => {
		const twin = item("file:w1:a.ts");
		expect(withPinned([twin], pinned, input("w1"), new Set()).map((row) => row.id)).toEqual([
			"file:w1:a.ts",
			"file:w1:a.ts",
		]);
		expect(withPinned([twin], pinned, input("w1"), new Set())[1]).toBe(pinned.item);
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

	test("a poll that brings nothing new moves no row, a group's hidden hits and its more row included", () => {
		const below: PaletteItem = { ...local, id: "chat:below", title: "Notes on xrefreshx" };
		const rows = (groups: readonly SearchGroup[], arrivals: Arrivals) =>
			flattenRows(
				buildSections({
					t,
					parsed: parseSearchQuery("refresh"),
					rootItems: [
						below,
						...hostItems(
							{
								t,
								openHit: () => {},
								projectName: () => "One",
								workspaceName: () => undefined,
								localIds: new Set([below.id]),
								late: arrivals.late,
								staleTerms: null,
							},
							groups,
						),
					],
					waiting: [],
					actions: [],
					expanded: new Set(),
					learning: EMPTY_LEARNING,
					nowMs: 0,
					keep: below.id,
				}),
			).map((row) => row.item.id);
		const page = [
			files("indexing", MATCH_TIER.prefix, [
				"refresh-1.ts",
				"refresh-2.ts",
				"refresh-3.ts",
				"refresh-4.ts",
				"refresh-5.ts",
				"refresh-6.ts",
			]),
		];
		let arrivals = noteArrivals(
			NO_ARRIVALS,
			page[0]?.hits.map((hit) => hit.id) ?? [],
			new Set(),
			false,
		);
		const first = rows(page, arrivals);
		expect(first).toContain("more:files");
		expect(first.at(-1)).toBe(below.id);
		arrivals = noteArrivals(
			arrivals,
			page[0]?.hits.map((hit) => hit.id) ?? [],
			new Set(first),
			true,
		);
		expect(arrivals.late.size).toBe(0);
		expect(rows(page, arrivals)).toEqual(first);
	});

	test("newcomers to a group shown above the selected row continue below every row on screen, a later cohort below an earlier one", () => {
		const chats = (titles: readonly string[]): SearchGroup => ({
			kind: "chat",
			state: "ready",
			total: titles.length,
			hits: titles.map((title, index) => ({
				id: `chat:w1:s${index}-${title}`,
				kind: "chat",
				title,
				tier: MATCH_TIER.prefix,
				score: 1,
				projectId: "p1",
				workspaceId: "w1",
				sessionId: `s${index}-${title}`,
			})),
		});
		let shown: SearchGroup[] | null = null;
		let arrivals = NO_ARRIVALS;
		let onScreen = new Set<string>(rowsOf([], arrivals));
		const land = (reply: SearchGroup[]) => {
			shown = mergeHostGroups(shown, reply);
			arrivals = noteArrivals(
				arrivals,
				shown.flatMap((group) => group.hits.map((hit) => hit.id)),
				onScreen,
				true,
			);
			const rows = rowsOf(shown, arrivals);
			onScreen = new Set(rows);
			return rows;
		};
		const names = ["a-refresh.ts", "b-refresh.ts"];
		const first = land([files("ready", MATCH_TIER.substring, names), chats(["Refresh early"])]);
		const selected = "file:p1:w1:b-refresh.ts";
		expect(first.indexOf("chat:w1:s0-Refresh early")).toBeLessThan(first.indexOf(selected));

		const second = land([
			files("ready", MATCH_TIER.substring, names),
			chats(["Refresh early", "Refresh late"]),
		]);
		expect(second.slice(0, first.length)).toEqual(first);
		const third = land([
			files("ready", MATCH_TIER.substring, [...names, "c-refresh.ts"]),
			chats(["Refresh early", "Refresh late", "Refresh later"]),
		]);
		expect(third.slice(0, second.length)).toEqual(second);
		expect(third.slice(second.length).sort()).toEqual(
			["chat:w1:s2-Refresh later", "file:p1:w1:c-refresh.ts"].sort(),
		);
	});
});
