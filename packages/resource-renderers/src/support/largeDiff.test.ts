import { describe, expect, test } from "bun:test";
import {
	estimateChangedLines,
	isDiffTooExpensive,
	LARGE_DIFF_CHANGED_LINES,
	surfaceChangedLines,
	surfaceLineCount,
} from "./largeDiff";

const text = (value: string) => ({ kind: "text" as const, text: value, hash: "h" });
const lines = (count: number, mark = "") =>
	Array.from({ length: count }, (_, index) => `line ${index}${mark}`).join("\n");

describe("estimateChangedLines", () => {
	test("counts removed and added lines as a multiset difference", () => {
		expect(estimateChangedLines("a\nb\nc", "a\nB\nc")).toBe(2);
		expect(estimateChangedLines("a\na\nb", "a\nb")).toBe(1);
		expect(estimateChangedLines("a\nb", "b\na")).toBe(0);
	});
});

describe("surfaceChangedLines", () => {
	test("treats an absent side as empty and binary sides as unchanged lines", () => {
		expect(surfaceChangedLines({ kind: "absent" }, text(lines(50_000)))).toBe(50_000);
		expect(surfaceChangedLines(text(""), text("a\nb"))).toBe(2);
		expect(
			surfaceChangedLines({ kind: "bytes", url: "u", hash: "h", byteLength: 1 }, text("a")),
		).toBe(0);
	});
});

test("surfaceLineCount includes unchanged context and both text sides", () => {
	expect(surfaceLineCount(text(lines(20_000)), text(lines(20_000, "!")))).toBe(20_000);
	expect(surfaceLineCount(text("a\nb\n"), text("a\n"))).toBe(2);
	expect(surfaceLineCount({ kind: "absent" }, text(""))).toBe(0);
});

describe("isDiffTooExpensive", () => {
	test("allows small, one-sided, and non-text diffs", () => {
		expect(isDiffTooExpensive(text(lines(10)), text(lines(10, "!")))).toBe(false);
		expect(isDiffTooExpensive(text(""), text(lines(50_000)))).toBe(false);
		expect(isDiffTooExpensive(text(lines(50_000)), { kind: "absent" })).toBe(false);
	});

	test("guards diffs once the estimate exceeds the threshold", () => {
		const count = LARGE_DIFF_CHANGED_LINES;
		expect(isDiffTooExpensive(text("unchanged"), text(`unchanged\n${lines(count)}`))).toBe(false);
		expect(isDiffTooExpensive(text(lines(count)), text(lines(count, "!")))).toBe(true);
	});

	test("guards expensive reorderings even when the multiset estimate is zero", () => {
		const original = lines(3_000);
		const modified = original.split("\n").reverse().join("\n");
		expect(surfaceChangedLines(text(original), text(modified))).toBe(0);
		expect(isDiffTooExpensive(text(original), text(modified))).toBe(true);
	});

	test("allows small moves and small edits in large files", () => {
		const original = lines(20_000);
		const moved = original.split("\n");
		const first = moved.shift();
		moved.push(first ?? "");
		expect(isDiffTooExpensive(text(original), text(moved.join("\n")))).toBe(false);
		expect(
			isDiffTooExpensive(text(original), text(original.replace("line 100", "edited 100"))),
		).toBe(false);
	});
});
