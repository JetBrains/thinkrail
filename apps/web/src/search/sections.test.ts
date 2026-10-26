import { describe, expect, test } from "bun:test";
import { RiChat2Line, RiCommandLine, RiGitBranchLine } from "@remixicon/react";
import { currentTranslator } from "@thinkrail/locales/react";
import { EMPTY_LEARNING, recordPick } from "./learning";
import type { PaletteItem } from "./model";
import { parseSearchQuery } from "./query";
import { buildSections, flattenRows, startEligible, startPrompt } from "./sections";

const chat = (id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
	id: `chat:${id}`,
	kind: "chat",
	title,
	group: "chats",
	scope: "work",
	icon: RiChat2Line,
	...extra,
});
const workspace = (id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
	id: `workspace:${id}`,
	kind: "workspace",
	title,
	group: "workspaces",
	scope: "work",
	icon: RiGitBranchLine,
	...extra,
});
const command = (id: string, title: string): PaletteItem => ({
	id: `command:${id}`,
	kind: "command",
	title,
	group: "commands",
	scope: "commands",
	icon: RiCommandLine,
});

const rootItems = [
	chat("a", "Fix auth token refresh", { attention: "needs-input" }),
	chat("b", "Auth flow follow-ups", { attention: "unread" }),
	chat("c", "Billing redesign", { attention: "running" }),
	workspace("w1", "Fix Auth Refresh"),
	workspace("w2", "Old experiment"),
	command("new", "New workspace…"),
	command("theme", "Change theme…"),
	...Array.from({ length: 6 }, (_, index) => chat(`x${index}`, `Auth note ${index}`)),
];

function sections(raw: string, extra: Partial<Parameters<typeof buildSections>[0]> = {}) {
	return buildSections({
		t: currentTranslator(),
		parsed: parseSearchQuery(raw),
		rootItems,
		waiting: [rootItems[0] as PaletteItem],
		actions: [rootItems[5] as PaletteItem],
		expanded: new Set(),
		learning: EMPTY_LEARNING,
		nowMs: 0,
		...extra,
	});
}

describe("buildSections", () => {
	test("the empty query shows waiting, recent and actions", () => {
		const learning = recordPick(EMPTY_LEARNING, "", "command:theme", 0);
		expect(sections("", { learning }).map((section) => section.id)).toEqual([
			"waiting",
			"recent",
			"actions",
		]);
	});

	test("Waiting stays bounded: eight rows, then a more row that expands it in place", () => {
		const waiting = Array.from({ length: 20 }, (_, index) =>
			chat(`w${index}`, `Waiting ${index}`, { attention: "needs-input" }),
		);
		const collapsed = sections("", { rootItems: waiting, waiting }).find(
			(section) => section.id === "waiting",
		);
		expect(collapsed?.items).toHaveLength(9);
		expect(collapsed?.items.at(-1)?.item.more).toEqual({
			kind: "expand",
			group: "waiting",
			nextId: "chat:w8",
		});
		const expanded = sections("", {
			rootItems: waiting,
			waiting,
			expanded: new Set(["waiting"]),
		}).find((section) => section.id === "waiting");
		expect(expanded?.items).toHaveLength(20);
	});

	test("a pick learned under a scope prefix latches the same words typed without it", () => {
		let learning = recordPick(EMPTY_LEARNING, "auth note", "chat:x3", 0);
		learning = recordPick(learning, "auth note", "chat:x3", 0);
		const scoped = sections("@auth note", { learning });
		const plain = sections("auth note", { learning });
		expect(scoped.find((section) => section.id === "chats")?.items[0]?.item.id).toBe("chat:x3");
		expect(plain[0]).toMatchObject({ id: "top", items: [{ item: { id: "chat:x3" } }] });
	});

	test("a row never appears twice: Recent skips what Waiting and Actions already show", () => {
		let learning = recordPick(EMPTY_LEARNING, "", "command:new", 0);
		learning = recordPick(learning, "", "chat:a", 0);
		learning = recordPick(learning, "", "command:theme", 0);
		const rows = flattenRows(sections("", { learning }));
		const ids = rows.map((row) => row.item.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain("command:theme");
	});

	test("a bare prefix lists its scope grouped, without the empty-state sections", () => {
		const result = sections(">");
		expect(result.map((section) => section.id)).toEqual(["commands"]);
		expect(flattenRows(result)).toHaveLength(2);
	});

	test("text groups by kind, caps All at four rows with a more row, and skips an unclear top hit", () => {
		const result = sections("auth");
		expect(result[0]?.id).not.toBe("top");
		const chats = result.find((section) => section.id === "chats");
		expect(chats?.items.length).toBe(5);
		expect(chats?.items.at(-1)?.item).toMatchObject({
			kind: "more",
			more: { kind: "scope", scope: "work" },
		});
	});

	test("a newcomer that landed while a selection was held never takes or unseats the top hit", () => {
		const best = chat("best", "Refresh");
		const ids = (rootItems: PaletteItem[]) =>
			flattenRows(sections("refresh", { rootItems })).map((row) => [row.item.id, row.top ?? false]);
		expect(ids([best])).toEqual([["chat:best", true]]);
		expect(ids([best, chat("late", "Refresh", { late: 1 })])).toEqual([
			["chat:best", true],
			["chat:late", false],
		]);
		expect(ids([chat("alone", "Refresh", { late: 1 })])).toEqual([["chat:alone", false]]);
	});

	test("a group's more row sits below the rows on screen when only newcomers overflow it, and stays with its rows otherwise", () => {
		const shown = ["one", "two", "three", "four"].map((name) => chat(name, `Fix refresh ${name}`));
		const selected = workspace("sel", "Old xrefreshx space");
		const rows = (rootItems: PaletteItem[]) =>
			flattenRows(sections("refresh", { rootItems, keep: selected.id })).map((row) => row.item.id);
		const before = rows([...shown, selected]);
		expect(before.at(-1)).toBe(selected.id);
		expect(before).not.toContain("more:chats");
		const late = [
			chat("l1", "Fix refresh late", { late: 1 }),
			chat("l2", "Fix refresh later", { late: 1 }),
		];
		const after = rows([...shown, selected, ...late]);
		expect(after.slice(0, before.length)).toEqual(before);
		expect(after.slice(before.length)).toEqual(["more:chats"]);
		const crowded = rows([...shown, chat("five", "Fix refresh five"), selected, ...late]);
		expect(crowded.indexOf("more:chats")).toBeLessThan(crowded.indexOf(selected.id));
	});

	test("a scope lifts the cap and never shows a top hit", () => {
		const result = sections("@auth");
		expect(
			result
				.find((section) => section.id === "chats")
				?.items.every((row) => row.item.kind !== "more"),
		).toBe(true);
		expect(result.some((section) => section.id === "top")).toBe(false);
	});

	test("the start row closes a typed query in All and Work, never in another scope, and opens the dialog with the text", () => {
		const opened: string[] = [];
		const start = { openDialog: (text: string) => opened.push(text) };
		const withStart = (raw: string) =>
			sections(raw, { start: { start, text: raw.replace(/^[@>]/, "").trim() } });
		const last = (raw: string) => withStart(raw).at(-1);
		expect(last("ship the thing")).toMatchObject({ id: "start" });
		expect(last("ship the thing")?.items[0]?.item).toMatchObject({
			kind: "start",
			title: "Start work with “ship the thing”…",
		});
		last("ship the thing")?.items[0]?.item.run?.();
		expect(opened).toEqual(["ship the thing"]);
		expect(last("@ship")?.id).toBe("start");
		expect(last(">ship")?.id).not.toBe("start");
		expect(flattenRows(withStart("zzz-no-match"))).toHaveLength(1);
		expect(startEligible(parseSearchQuery("/ship"))).toBe(false);
		expect(startEligible(parseSearchQuery("   "))).toBe(false);
	});

	test("the prompt is the text as typed: the scope prefix goes, inner whitespace and quotes stay", () => {
		const raw = "  replace 'a  b' with 'a b'  ";
		expect(startPrompt(raw, parseSearchQuery(raw))).toBe("replace 'a  b' with 'a b'");
		expect(startPrompt("@ fix  it", parseSearchQuery("@ fix  it"))).toBe("fix  it");
		expect(startPrompt("#812", parseSearchQuery("#812"))).toBe("#812");
	});

	test("a scoped group past its cap ends in a more row that expands it in place", () => {
		const many = Array.from({ length: 35 }, (_, index) => chat(`m${index}`, `Many ${index}`));
		const collapsed = sections("@", { rootItems: many });
		const chats = collapsed.find((section) => section.id === "chats");
		expect(chats?.items).toHaveLength(31);
		expect(chats?.items.at(-1)?.item.more).toEqual({
			kind: "expand",
			group: "chats",
			nextId: "chat:m30",
		});
		const expanded = sections("@", { rootItems: many, expanded: new Set(["chats"]) });
		expect(expanded.find((section) => section.id === "chats")?.items).toHaveLength(35);
	});

	test("host hits beyond the returned page count into the more row in All and into the meta of a scope", () => {
		const two = [chat("h1", "Auth one"), chat("h2", "Auth two")];
		const hostTotals = { chats: { total: 20, ids: new Set(two.map((item) => item.id)) } };
		const all = sections("auth", { rootItems: two, hostTotals });
		const chats = all.find((section) => section.id === "chats");
		expect(chats?.meta).toBe("20");
		expect(chats?.items.at(-1)?.item).toMatchObject({
			kind: "more",
			title: "18 more in Chats",
			more: { kind: "scope", scope: "work" },
		});
		const scoped = sections("@auth", { rootItems: two, hostTotals });
		const scopedChats = scoped.find((section) => section.id === "chats");
		expect(scopedChats?.meta).toBe("20 matches · showing 2, refine the query for the rest");
		expect(scopedChats?.items.every((row) => row.item.kind !== "more")).toBe(true);
	});

	test("local rows the host page left out count among its overflow, so a chat shown twice is never counted twice", () => {
		const local = Array.from({ length: 40 }, (_, index) => chat(`c${index}`, `Auth ${index}`));
		const page = new Set(local.slice(0, 20).map((item) => item.id));
		const all = sections("auth", {
			rootItems: local,
			hostTotals: { chats: { total: 40, ids: page } },
		});
		const chats = all.find((section) => section.id === "chats");
		expect(chats?.meta).toBe("40");
		expect(chats?.items.at(-1)?.item.title).toBe("36 more in Chats");
	});

	test("a local row that only its subtitle matches is not taken to be one of the host's hits", () => {
		const page = Array.from({ length: 50 }, (_, index) => chat(`h${index}`, `Auth ${index}`));
		const local = Array.from({ length: 5 }, (_, index) =>
			chat(`l${index}`, `Notes ${index}`, { subtitle: "Auth project" }),
		);
		const scoped = sections("@auth", {
			rootItems: [...page, ...local],
			hostTotals: { chats: { total: 55, ids: new Set(page.map((item) => item.id)) } },
		});
		expect(scoped.find((section) => section.id === "chats")?.meta).toBe(
			"60 matches · showing 55, refine the query for the rest",
		);
	});

	test("the selected row is never hidden under a group's cap", () => {
		const many = Array.from({ length: 8 }, (_, index) => chat(`k${index}`, `Keep ${index}`));
		const rows = (keep: string | null) =>
			flattenRows(sections("keep", { rootItems: many, keep })).map((row) => row.item.id);
		expect(rows(null)).not.toContain("chat:k6");
		expect(rows("chat:k6")).toContain("chat:k6");
	});

	test("a local workspace the host matches by its branch counts among the host's hits", () => {
		const local = Array.from({ length: 60 }, (_, index) =>
			workspace(`w${index}`, `Notes ${index}`, {
				subtitle: `One · auth-${index}`,
				hostFields: [
					{ key: "title", text: `Notes ${index}` },
					{ key: "subtitle", text: `auth-${index}`, secondary: true },
				],
			}),
		);
		const page = new Set(local.slice(0, 50).map((item) => item.id));
		const scoped = sections("@auth", {
			rootItems: local,
			hostTotals: { workspaces: { total: 60, ids: page } },
		});
		expect(scoped.find((section) => section.id === "workspaces")?.meta).toBe("60");
	});
});
