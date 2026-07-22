import { describe, expect, test } from "bun:test";
import { reverseApplyPatch } from "./unifiedDiff";

function hunks(...lines: string[]): string {
	return `diff --git a/f b/f\nindex 000..111 100644\n--- a/f\n+++ b/f\n${lines.join("\n")}\n`;
}

describe("reverseApplyPatch (old side from new content + unified patch)", () => {
	test("modification: replaced line reconstructs to the base version", () => {
		const patch = hunks("@@ -1,3 +1,3 @@", " alpha", "-old middle", "+new middle", " omega");
		expect(reverseApplyPatch(patch, "alpha\nnew middle\nomega\n")).toBe(
			"alpha\nold middle\nomega\n",
		);
	});

	test("pure insertion: added lines vanish from the old side", () => {
		const patch = hunks("@@ -1,2 +1,3 @@", " one", "+inserted", " two");
		expect(reverseApplyPatch(patch, "one\ninserted\ntwo\n")).toBe("one\ntwo\n");
	});

	test("pure deletion: removed lines reappear in the old side", () => {
		const patch = hunks("@@ -1,3 +1,2 @@", " one", "-gone", " two");
		expect(reverseApplyPatch(patch, "one\ntwo\n")).toBe("one\ngone\ntwo\n");
	});

	test("added/untracked file (all-plus hunk) reconstructs to empty", () => {
		const patch = hunks("@@ -0,0 +1,2 @@", "+hello", "+world");
		expect(reverseApplyPatch(patch, "hello\nworld\n")).toBe("");
	});

	test("deleted file (all-minus hunk over empty new content) yields the full old file", () => {
		const patch = hunks("@@ -1,2 +0,0 @@", "-hello", "-world");
		expect(reverseApplyPatch(patch, "")).toBe("hello\nworld\n");
	});

	test("multiple hunks apply in order with untouched regions copied through", () => {
		const patch = hunks(
			"@@ -1,3 +1,3 @@",
			" a",
			"-b",
			"+B",
			" c",
			"@@ -10,3 +10,3 @@",
			" j",
			"-k",
			"+K",
			" l",
		);
		const now = "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\n";
		expect(reverseApplyPatch(patch, now)).toBe("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n");
	});

	test("no-newline-at-EOF marker on the old side drops the trailing newline", () => {
		const patch = hunks("@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new");
		expect(reverseApplyPatch(patch, "new\n")).toBe("old");
	});

	test("empty patch means no textual change — old equals new", () => {
		expect(reverseApplyPatch("", "same\n")).toBe("same\n");
	});

	test("a patch that doesn't match the content returns null (degrade, don't lie)", () => {
		const patch = hunks("@@ -1,2 +1,2 @@", " kept", "-old", "+expected");
		expect(reverseApplyPatch(patch, "kept\nactual-drifted\n")).toBeNull();
	});

	test("garbage without hunks returns null", () => {
		expect(reverseApplyPatch("not a diff at all", "x\n")).toBeNull();
	});
});
