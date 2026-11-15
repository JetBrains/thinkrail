import { describe, expect, it } from "bun:test";
import { extendTypeAhead, treeRowKey, typeAheadTarget } from "./treeNavigation";

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
