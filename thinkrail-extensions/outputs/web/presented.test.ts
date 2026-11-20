import { expect, test } from "bun:test";
import { readPresentedFiles } from "./presented";

test("the published files come from the result, else from what the call asked for", () => {
	expect(
		readPresentedFiles(
			{ filepaths: ["report.md"] },
			{ details: { files: [".thinkrail/context/report.md"] } },
		),
	).toEqual([".thinkrail/context/report.md"]);
	expect(readPresentedFiles({ filepaths: ["a.md", "a.md", "", 4] }, undefined)).toEqual(["a.md"]);
	expect(readPresentedFiles({}, { details: {} })).toEqual([]);
});
