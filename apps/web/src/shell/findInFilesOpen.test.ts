import { expect, test } from "bun:test";
import { openFindInFilesMatch } from "./findInFilesOpen";

const target = {
	projectId: "p1",
	workspaceId: "w1",
	path: "src/a.ts",
	line: 3,
	column: 5,
	length: 6,
};

test("a match opens at its line only after the navigator entered its workspace", async () => {
	const asked: unknown[] = [];
	const opened: unknown[][] = [];
	const openAt = async (...args: unknown[]) => {
		opened.push(args);
	};
	await openFindInFilesMatch(
		target,
		true,
		async (workspace) => {
			asked.push(workspace);
			return true;
		},
		openAt,
	);
	expect(asked).toEqual([{ id: "w1", projectId: "p1" }]);
	expect(opened).toEqual([["w1", "src/a.ts", { line: 3, column: 5, length: 6 }, "keep"]]);

	await openFindInFilesMatch(target, false, async () => false, openAt);
	expect(opened).toHaveLength(1);
});
