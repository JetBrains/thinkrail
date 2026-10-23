import { describe, expect, test } from "bun:test";
import { RiChat2Line, RiCommandLine, RiGitBranchLine } from "@remixicon/react";
import { currentTranslator } from "@thinkrail/locales/react";
import { EMPTY_LEARNING, recordPick } from "./learning";
import type { PaletteItem } from "./model";
import { parseSearchQuery } from "./query";
import { buildSections, flattenRows, type PalettePage } from "./sections";

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
	chat("a", "Fix auth token refresh", { attention: "needs-input", states: ["waiting"] }),
	chat("b", "Auth flow follow-ups", { attention: "unread", states: ["error", "unread"] }),
	chat("c", "Billing redesign", { attention: "running", states: ["running", "error"] }),
	workspace("w1", "Fix Auth Refresh", { hasPr: true, states: ["waiting", "error", "unread"] }),
	workspace("w2", "Old experiment", { settled: true }),
	command("new", "New workspace…"),
	command("theme", "Change theme…"),
	...Array.from({ length: 6 }, (_, index) => chat(`x${index}`, `Auth note ${index}`)),
];

function sections(raw: string, extra: Partial<Parameters<typeof buildSections>[0]> = {}) {
	return buildSections({
		t: currentTranslator(),
		parsed: parseSearchQuery(raw),
		page: null,
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

	test("a partial filter suggests filters with counts", () => {
		const [filters] = sections("is:");
		expect(filters?.id).toBe("filters");
		expect(filters?.items.find((row) => row.item.title === "is:waiting")?.item.meta).toBe("2");
	});

	test("state filters narrow work items and combine with text", () => {
		expect(flattenRows(sections("is:running")).map((row) => row.item.id)).toEqual(["chat:c"]);
		expect(
			flattenRows(sections("is:error"))
				.map((row) => row.item.id)
				.sort(),
		).toEqual(["chat:b", "chat:c", "workspace:w1"]);
		expect(flattenRows(sections("is:settled")).map((row) => row.item.id)).toEqual(["workspace:w2"]);
		expect(flattenRows(sections("has:pr auth")).map((row) => row.item.id)).toEqual([
			"workspace:w1",
		]);
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

	test("a scope lifts the cap and never shows a top hit", () => {
		const result = sections("@auth");
		expect(
			result
				.find((section) => section.id === "chats")
				?.items.every((row) => row.item.kind !== "more"),
		).toBe(true);
		expect(result.some((section) => section.id === "top")).toBe(false);
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

	test("the start row closes a typed root query in All and Work, never on a page, a filter or another scope", () => {
		const start = {
			targets: [{ kind: "workspace" as const, label: "New workspace", detail: "Start in One" }],
			run: () => {},
			openDialog: () => {},
		};
		const target = start.targets[0] as (typeof start.targets)[number];
		const withStart = (raw: string) =>
			sections(raw, { start: { start, target, text: raw.replace(/^[@>]/, "").trim() } });
		const last = (raw: string) => withStart(raw).at(-1);
		expect(last("ship the thing")).toMatchObject({ id: "start" });
		expect(last("ship the thing")?.items[0]?.item).toMatchObject({
			kind: "start",
			title: "ship the thing",
			badge: "New workspace",
		});
		expect(last("@ship")?.id).toBe("start");
		expect(last(">ship")?.id).not.toBe("start");
		expect(last("is:unread ship")?.id).not.toBe("start");
		expect(flattenRows(withStart("zzz-no-match"))).toHaveLength(1);
	});

	test("pages rank within their own sections", () => {
		const page: PalettePage = {
			id: "theme",
			crumb: ["Theme"],
			placeholder: "",
			sections: () => [
				{ title: "Themes", items: [command("dark", "Dark"), command("light", "Light")] },
			],
		};
		expect(flattenRows(sections("", { page })).map((row) => row.item.title)).toEqual([
			"Dark",
			"Light",
		]);
		expect(flattenRows(sections("lig", { page })).map((row) => row.item.title)).toEqual(["Light"]);
	});
});
