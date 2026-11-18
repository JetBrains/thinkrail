import { describe, expect, test } from "bun:test";
import { figure, listResult, PROJECTS, sessionRow } from "./fixtures.test";
import { DEFAULT_SORT, groupRows, nextSort, sortRows } from "./rows";

const ids = (rows: readonly { sessionId: string }[]) => rows.map((row) => row.sessionId);

describe("groupRows", () => {
	test("groups in the server's project order and keeps sessions outside every project last", () => {
		const result = listResult(
			[
				sessionRow("b1", { projectId: "p2" }),
				sessionRow("orphan", { projectId: null, workspaceId: null, workspaceState: "none" }),
				sessionRow("a1"),
				sessionRow("b2", { projectId: "p2" }),
				sessionRow("stray", { projectId: "retired" }),
			],
			{ projects: [PROJECTS[1], PROJECTS[0]].flatMap((project) => (project ? [project] : [])) },
		);
		const groups = groupRows(result, DEFAULT_SORT);
		expect(groups.map((group) => group.project?.id ?? null)).toEqual(["p2", "p1", null]);
		expect(groups.map((group) => ids(group.rows))).toEqual([
			["b1", "b2"],
			["a1"],
			["orphan", "stray"],
		]);
	});
});

describe("sortRows", () => {
	const rows = [
		sessionRow("a", { cost: figure(1, "recorded"), toolCalls: figure(5, "counted") }),
		sessionRow("b", { cost: figure<number>(null, "notRecorded"), toolCalls: figure(5, "counted") }),
		sessionRow("c", { cost: figure(3, "recorded"), toolCalls: figure(9, "counted") }),
		sessionRow("d", { cost: figure(0, "notRecorded"), toolCalls: figure(1, "counted") }),
	];

	test("orders by the chosen figure, missing values last in either direction", () => {
		expect(ids(sortRows(rows, { key: "cost", direction: "desc" }))).toEqual(["c", "a", "d", "b"]);
		expect(ids(sortRows(rows, { key: "cost", direction: "asc" }))).toEqual(["d", "a", "c", "b"]);
	});

	test("keeps the server's order between equal values", () => {
		expect(ids(sortRows(rows, { key: "calls", direction: "desc" }))).toEqual(["c", "a", "b", "d"]);
		expect(ids(sortRows(rows, { key: "calls", direction: "asc" }))).toEqual(["d", "a", "b", "c"]);
	});

	test("reads tokens from the recorded total", () => {
		const small = sessionRow("small", {
			tokens: figure({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, "recorded"),
		});
		const large = sessionRow("large");
		expect(ids(sortRows([small, large], { key: "tokens", direction: "desc" }))).toEqual([
			"large",
			"small",
		]);
	});
});

test("a new column sorts descending first and the same column flips direction", () => {
	expect(DEFAULT_SORT).toEqual({ key: "start", direction: "desc" });
	expect(nextSort(DEFAULT_SORT, "cost")).toEqual({ key: "cost", direction: "desc" });
	expect(nextSort({ key: "cost", direction: "desc" }, "cost")).toEqual({
		key: "cost",
		direction: "asc",
	});
	expect(nextSort({ key: "cost", direction: "asc" }, "cost")).toEqual({
		key: "cost",
		direction: "desc",
	});
});
