import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import { plainDiffRuns, plainFileRuns } from "./plainRuns";

const runsOf = (runs: ReturnType<typeof plainFileRuns>) =>
	runs.map((run) => [run.kind, run.lines] as const);

describe("plainFileRuns", () => {
	test("keeps the file as one run of lines without terminators, ignoring the final newline", () => {
		expect(runsOf(plainFileRuns("one\r\ntwo\n\nfour\n"))).toEqual([
			["context", ["one", "two", "", "four"]],
		]);
	});

	test("keeps one empty line for an empty file", () => {
		expect(runsOf(plainFileRuns(""))).toEqual([["context", [""]]]);
	});
});

describe("plainDiffRuns", () => {
	test("lists each hunk's header, then its context, deletion and addition runs in order", () => {
		const diff = parseDiffFromFile(
			{ name: "a.ts", contents: "one\ntwo\nthree\n" },
			{ name: "a.ts", contents: "one\nTWO\nthree\nfour\n" },
		);
		const runs = plainDiffRuns(diff);
		expect(runsOf(runs)).toEqual([
			["hunk", ["@@ -1,3 +1,4 @@"]],
			["context", ["one"]],
			["deletion", ["two"]],
			["addition", ["TWO"]],
			["context", ["three"]],
			["addition", ["four"]],
		]);
		expect(new Set(runs.map((run) => run.key)).size).toBe(runs.length);
	});

	test("shows an added file as one run of additions however long it is", () => {
		const contents = Array.from({ length: 100_000 }, (_, line) => `line ${line}`).join("\n");
		const runs = plainDiffRuns(parseDiffFromFile(null, { name: "b.ts", contents }));
		expect(runs.map((run) => [run.kind, run.lines.length])).toEqual([
			["hunk", 1],
			["addition", 100_000],
		]);
		expect(runs[1]?.lines.at(-1)).toBe("line 99999");
	});
});
