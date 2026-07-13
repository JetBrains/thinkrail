import { expect, test } from "bun:test";
import { wordDiff } from "./wordDiff";

test("identical text is all 'same'", () => {
	expect(wordDiff("a b c", "a b c")).toEqual([{ kind: "same", text: "a b c" }]);
});

test("a replaced word shows del then add", () => {
	const parts = wordDiff("the quick fox", "the slow fox");
	expect(parts.filter((p) => p.kind === "del").map((p) => p.text.trim())).toContain("quick");
	expect(parts.filter((p) => p.kind === "add").map((p) => p.text.trim())).toContain("slow");
	// the unchanged head/tail survive
	expect(parts[0]).toEqual({ kind: "same", text: "the " });
});

test("pure insertion yields only same + add", () => {
	const parts = wordDiff("a c", "a b c");
	expect(parts.some((p) => p.kind === "del")).toBe(false);
	expect(parts.some((p) => p.kind === "add" && p.text.includes("b"))).toBe(true);
});

test("empty old (full insert) is one add", () => {
	expect(wordDiff("", "hello")).toEqual([{ kind: "add", text: "hello" }]);
});
