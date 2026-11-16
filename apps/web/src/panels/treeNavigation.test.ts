import { describe, expect, it } from "bun:test";
import {
	type TreeSearchRow,
	treeRowKey,
	treeSearchMatches,
	treeSearchStep,
	treeSearchTarget,
} from "./treeNavigation";

describe("tree search", () => {
	const rows: TreeSearchRow[] = [
		{ id: "readme", label: "README.md" },
		{ id: "src", label: "src" },
		{ id: "scripts", label: "scripts" },
		{ id: "spec", label: "Spec notes" },
		{ id: "notes", label: "notes.txt" },
	];

	it("matches a substring of the label case-insensitively, in row order", () => {
		expect(treeSearchMatches(rows, "S")).toEqual(["src", "scripts", "spec", "notes"]);
		expect(treeSearchMatches(rows, "note")).toEqual(["spec", "notes"]);
		expect(treeSearchMatches(rows, "ME.m")).toEqual(["readme"]);
		expect(treeSearchMatches(rows, "")).toEqual([]);
		expect(treeSearchMatches(rows, "zzz")).toEqual([]);
	});

	it("lands on the first match at or after the anchor, wrapping, and stays while it still matches", () => {
		expect(treeSearchTarget(rows, "note", "src")).toBe("spec");
		expect(treeSearchTarget(rows, "note", "notes")).toBe("notes");
		expect(treeSearchTarget(rows, "src", "notes")).toBe("src");
		expect(treeSearchTarget(rows, "s", "scripts")).toBe("scripts");
		expect(treeSearchTarget(rows, "note", null)).toBe("spec");
		expect(treeSearchTarget(rows, "zzz", "src")).toBeNull();
		expect(treeSearchTarget(rows, "", "src")).toBeNull();
	});

	it("steps to the next and previous match, wrapping at both ends", () => {
		expect(treeSearchStep(rows, "note", "spec", 1)).toBe("notes");
		expect(treeSearchStep(rows, "note", "notes", 1)).toBe("spec");
		expect(treeSearchStep(rows, "note", "spec", -1)).toBe("notes");
		expect(treeSearchStep(rows, "note", "notes", -1)).toBe("spec");
		expect(treeSearchStep(rows, "note", "readme", 1)).toBe("spec");
		expect(treeSearchStep(rows, "note", "readme", -1)).toBe("notes");
		expect(treeSearchStep(rows, "note", null, 1)).toBe("spec");
		expect(treeSearchStep(rows, "note", null, -1)).toBe("notes");
		expect(treeSearchStep(rows, "zzz", "src", 1)).toBeNull();
	});
});

describe("treeRowKey", () => {
	const key = (init: Partial<Parameters<typeof treeRowKey>[0]> & { key: string }) =>
		treeRowKey({
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			defaultPrevented: false,
			...init,
		});

	it("names the row actions a key asks for", () => {
		expect(key({ key: "ContextMenu" })).toBe("menu");
		expect(key({ key: "F10", shiftKey: true })).toBe("menu");
		expect(key({ key: "Delete" })).toBe("delete");
		expect(key({ key: "F2" })).toBe("rename");
	});

	it("ignores modified or already handled keys", () => {
		expect(key({ key: "F10" })).toBeNull();
		expect(key({ key: "Delete", ctrlKey: true })).toBeNull();
		expect(key({ key: "F2", altKey: true })).toBeNull();
		expect(key({ key: "Delete", defaultPrevented: true })).toBeNull();
	});
});
