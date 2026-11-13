import { describe, expect, it } from "bun:test";
import {
	extendTypeAhead,
	resolveTreeMove,
	type TreeRowModel,
	treeRowKey,
	typeAheadTarget,
} from "./treeNavigation";

const row = (level: number, expanded?: boolean): TreeRowModel => ({
	level,
	expanded,
	label: "",
});

const rows = [row(1, true), row(2), row(2, false), row(1, true), row(1)];

describe("resolveTreeMove", () => {
	it("steps through the visible rows and stops at either end", () => {
		expect(resolveTreeMove("ArrowDown", rows, 0)).toEqual({ kind: "focus", index: 1 });
		expect(resolveTreeMove("ArrowUp", rows, 1)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("ArrowUp", rows, 0)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("ArrowDown", rows, 4)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("Home", rows, 3)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("End", rows, 0)).toEqual({ kind: "focus", index: 4 });
	});

	it("expands a collapsed row, then enters its first child", () => {
		expect(resolveTreeMove("ArrowRight", rows, 2)).toEqual({ kind: "toggle" });
		expect(resolveTreeMove("ArrowRight", rows, 0)).toEqual({ kind: "focus", index: 1 });
		expect(resolveTreeMove("ArrowRight", rows, 3)).toEqual({ kind: "stay" });
		expect(resolveTreeMove("ArrowRight", rows, 1)).toEqual({ kind: "stay" });
	});

	it("collapses an expanded row, else returns to its parent", () => {
		expect(resolveTreeMove("ArrowLeft", rows, 0)).toEqual({ kind: "toggle" });
		expect(resolveTreeMove("ArrowLeft", rows, 2)).toEqual({ kind: "focus", index: 0 });
		expect(resolveTreeMove("ArrowLeft", rows, 4)).toEqual({ kind: "stay" });
	});

	it("leaves every other key alone", () => {
		expect(resolveTreeMove("Enter", rows, 0)).toBeNull();
		expect(resolveTreeMove("a", rows, 0)).toBeNull();
	});
});

describe("type-ahead", () => {
	const labels = ["README.md", "readme-old", "src", "scripts", "Spec notes"];

	it("buffers keys typed within half a second and restarts after a pause", () => {
		const first = extendTypeAhead({ text: "", at: 0 }, "s", 1_000);
		expect(first).toEqual({ text: "s", at: 1_000 });
		if (!first) throw new Error("no buffer");
		expect(extendTypeAhead(first, "c", 1_300)).toEqual({ text: "sc", at: 1_300 });
		expect(extendTypeAhead(first, "c", 1_600)).toEqual({ text: "c", at: 1_600 });
	});

	it("lets Space join only a live buffer", () => {
		expect(extendTypeAhead({ text: "", at: 0 }, " ", 100)).toBeNull();
		expect(extendTypeAhead({ text: "spec", at: 1_000 }, " ", 1_400)).toEqual({
			text: "spec ",
			at: 1_400,
		});
		expect(extendTypeAhead({ text: "spec", at: 1_000 }, " ", 2_000)).toBeNull();
	});

	it("matches a label prefix case-insensitively, from the next row for one letter", () => {
		expect(typeAheadTarget(labels, 0, "r")).toBe(1);
		expect(typeAheadTarget(labels, 1, "r")).toBe(0);
		expect(typeAheadTarget(labels, 2, "sc")).toBe(3);
		expect(typeAheadTarget(labels, 2, "sr")).toBe(2);
		expect(typeAheadTarget(labels, 0, "spec ")).toBe(4);
		expect(typeAheadTarget(labels, 0, "x")).toBeNull();
	});

	it("cycles through rows sharing a letter when that letter repeats", () => {
		expect(typeAheadTarget(labels, 2, "ss")).toBe(3);
		expect(typeAheadTarget(labels, 3, "sss")).toBe(4);
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
