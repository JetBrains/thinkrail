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

// The core invariant the DiffPart docstring promises: same+del re-joins to the exact old text, same+add to
// the exact new text (trailing whitespace preserved). This is what makes the woven-diff render lossless.
test("round-trip: same+del reproduces old, same+add reproduces new", () => {
	const cases: Array<[string, string]> = [
		["the quick brown fox", "the slow brown fox jumps"],
		["a  b   c", "a b c"], // collapsed whitespace runs
		["line one\nline two\n", "line one\nline TWO\nline three\n"],
		["", "brand new content"],
		["deleted entirely", ""],
		["unchanged", "unchanged"],
	];
	for (const [oldText, newText] of cases) {
		const parts = wordDiff(oldText, newText);
		const old = parts
			.filter((p) => p.kind !== "add")
			.map((p) => p.text)
			.join("");
		const neu = parts
			.filter((p) => p.kind !== "del")
			.map((p) => p.text)
			.join("");
		expect(old).toBe(oldText);
		expect(neu).toBe(newText);
	}
});
