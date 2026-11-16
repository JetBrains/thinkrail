import { describe, expect, it } from "bun:test";
import { localKeys } from "@thinkrail/ui/local-keys";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
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
	const keys = localKeys(null, "trees", LOCAL_KEY_DEFAULTS.trees);
	const key = (init: { key: string; code?: string } & Partial<KeyboardEvent>) =>
		treeRowKey(
			{
				code: init.key,
				shiftKey: false,
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				isComposing: false,
				keyCode: 0,
				target: null,
				defaultPrevented: false,
				...init,
			},
			keys,
		);

	it("names the row actions a key asks for", () => {
		expect(key({ key: "ContextMenu" })).toBe("menu");
		expect(key({ key: "F10", shiftKey: true })).toBe("menu");
		expect(key({ key: "Delete" })).toBe("delete");
		expect(key({ key: "F2" })).toBe("rename");
		expect(key({ key: "ArrowUp", altKey: true, shiftKey: true })).toBe("reorderUp");
		expect(key({ key: "ArrowDown", altKey: true, shiftKey: true })).toBe("reorderDown");
	});

	it("ignores modified or already handled keys", () => {
		expect(key({ key: "F10" })).toBeNull();
		expect(key({ key: "Delete", ctrlKey: true })).toBeNull();
		expect(key({ key: "F2", altKey: true })).toBeNull();
		expect(key({ key: "ArrowUp", altKey: true })).toBeNull();
		expect(key({ key: "Delete", defaultPrevented: true })).toBeNull();
	});

	it("follows a rebound key and drops the default", () => {
		const rebound = localKeys(
			{
				platform: "Linux x86_64",
				scopes: new Map([["trees", [{ id: "trees.rename", chord: { code: "KeyR", key: "R" } }]]]),
				isTextEntry: () => false,
			},
			"trees",
			LOCAL_KEY_DEFAULTS.trees,
		);
		const press = (code: string) =>
			treeRowKey(
				{
					code,
					key: code === "KeyR" ? "к" : code,
					shiftKey: false,
					altKey: false,
					ctrlKey: false,
					metaKey: false,
					isComposing: false,
					keyCode: 0,
					target: null,
					defaultPrevented: false,
				},
				rebound,
			);
		expect(press("KeyR")).toBe("rename");
		expect(press("F2")).toBeNull();
		expect(press("Delete")).toBeNull();
	});
});
