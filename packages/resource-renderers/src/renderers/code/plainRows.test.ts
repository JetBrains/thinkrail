import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import { plainDiffRows, plainFileRows } from "./plainRows";

const rowsOf = (rows: ReturnType<typeof plainFileRows>) =>
	rows.map((row) => [row.kind, row.text] as const);

describe("plainFileRows", () => {
	test("lists each line without its terminator, ignoring the final newline", () => {
		expect(rowsOf(plainFileRows("one\r\ntwo\n\nfour\n"))).toEqual([
			["context", "one"],
			["context", "two"],
			["context", ""],
			["context", "four"],
		]);
	});

	test("keeps one empty row for an empty file", () => {
		expect(rowsOf(plainFileRows(""))).toEqual([["context", ""]]);
	});
});

describe("plainDiffRows", () => {
	test("lists each hunk's header, context, deletions and additions in order", () => {
		const diff = parseDiffFromFile(
			{ name: "a.ts", contents: "one\ntwo\nthree\n" },
			{ name: "a.ts", contents: "one\nTWO\nthree\nfour\n" },
		);
		const rows = plainDiffRows(diff);
		expect(rowsOf(rows)).toEqual([
			["hunk", "@@ -1,3 +1,4 @@"],
			["context", "one"],
			["deletion", "two"],
			["addition", "TWO"],
			["context", "three"],
			["addition", "four"],
		]);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});

	test("shows an added file as additions only", () => {
		const diff = parseDiffFromFile(null, { name: "b.ts", contents: "x\ny\n" });
		expect(rowsOf(plainDiffRows(diff))).toEqual([
			["hunk", "@@ -0,0 +1,2 @@"],
			["addition", "x"],
			["addition", "y"],
		]);
	});
});
