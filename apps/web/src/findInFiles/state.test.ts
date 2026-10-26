import { beforeEach, describe, expect, test } from "bun:test";
import type { TextSearchFile } from "@thinkrail/contracts";
import {
	applyTextSearchBatch,
	beginTextSearch,
	clearTextSearch,
	effectiveCaseSensitive,
	failTextSearch,
	mergeFiles,
	resetFindInFilesForTests,
	selectFindInFilesMatch,
	useFindInFiles,
} from "./state";

const file = (path: string, ...lines: number[]): TextSearchFile => ({
	path,
	matches: lines.map((line) => ({ line, column: 1, length: 1, text: "x", ranges: [[0, 1]] })),
});

beforeEach(() => resetFindInFilesForTests());

describe("smart case", () => {
	test("a capital letter in the query makes the search exact, like the toggle", () => {
		expect(effectiveCaseSensitive("needle", false)).toBe(false);
		expect(effectiveCaseSensitive("Needle", false)).toBe(true);
		expect(effectiveCaseSensitive("needle", true)).toBe(true);
		expect(effectiveCaseSensitive("Ünïcode", false)).toBe(true);
	});
});

describe("mergeFiles", () => {
	test("appends matches of a file already listed and keeps the file order", () => {
		const merged = mergeFiles(
			[file("a.ts", 1), file("b.ts", 2)],
			[file("b.ts", 9), file("c.ts", 3)],
		);
		expect(merged.map((entry) => entry.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(merged[1]?.matches.map((match) => match.line)).toEqual([2, 9]);
	});
});

describe("batches", () => {
	test("only the latest seq is applied; the first batch selects the first match and done ends the search", () => {
		beginTextSearch(7, "ctx");
		expect(useFindInFiles.getState().searching).toBe(true);
		applyTextSearchBatch({ seq: 6, files: [file("stale.ts", 1)] });
		expect(useFindInFiles.getState().results).toBeNull();

		applyTextSearchBatch({
			seq: 7,
			root: { projectId: "p", workspaceId: "w" },
			files: [file("a.ts", 1, 5)],
		});
		const state = useFindInFiles.getState();
		expect(state.results?.contextKey).toBe("ctx");
		expect(state.results?.root).toEqual({ projectId: "p", workspaceId: "w" });
		expect(state.selected).toEqual({ path: "a.ts", line: 1 });
		expect(state.searching).toBe(true);

		applyTextSearchBatch({
			seq: 7,
			files: [file("b.ts", 2)],
			done: { reason: "limit", files: 2, lines: 3 },
		});
		const done = useFindInFiles.getState();
		expect(done.results?.files.map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
		expect(done.results?.done).toEqual({ reason: "limit", files: 2, lines: 3 });
		expect(done.searching).toBe(false);
		expect(done.failed).toBe(false);
	});

	test("a new seq replaces the results and keeps the selection only while its file is still listed", () => {
		beginTextSearch(1, "ctx");
		applyTextSearchBatch({ seq: 1, files: [file("a.ts", 1), file("b.ts", 4)] });
		selectFindInFilesMatch({ path: "b.ts", line: 4 });

		applyTextSearchBatch({ seq: 1, files: [file("c.ts", 9)] });
		expect(useFindInFiles.getState().selected).toEqual({ path: "b.ts", line: 4 });

		beginTextSearch(2, "ctx");
		applyTextSearchBatch({ seq: 2, files: [file("c.ts", 9)] });
		const fresh = useFindInFiles.getState();
		expect(fresh.results?.files.map((entry) => entry.path)).toEqual(["c.ts"]);
		expect(fresh.selected).toEqual({ path: "c.ts", line: 9 });
	});

	test("a failed end and a transport failure both mark the search failed; a short query clears it", () => {
		beginTextSearch(3, "ctx");
		applyTextSearchBatch({ seq: 3, files: [], done: { reason: "failed", files: 0, lines: 0 } });
		expect(useFindInFiles.getState().failed).toBe(true);

		beginTextSearch(4, "ctx");
		failTextSearch(3);
		expect(useFindInFiles.getState().failed).toBe(false);
		failTextSearch(4);
		expect(useFindInFiles.getState()).toMatchObject({ searching: false, failed: true });

		clearTextSearch();
		expect(useFindInFiles.getState()).toMatchObject({
			searching: false,
			failed: false,
			results: null,
			selected: null,
		});
	});
});
