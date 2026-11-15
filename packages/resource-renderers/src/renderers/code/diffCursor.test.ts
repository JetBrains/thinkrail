import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { CursorCommand } from "../../support/cursorKeys";
import {
	type DiffCursor,
	type DiffCursorLayout,
	type DiffCursorState,
	diffCursorCommand,
	diffCursorRows,
	diffCursorStop,
	diffLineText,
	initialDiffCursor,
	snapDiffCursor,
} from "./diffCursor";
import { renderedDiffLineNumbers } from "./pierreReview";

const original = Array.from({ length: 10 }, (_, index) => `l${index + 1}`);
const modified = [...original.slice(0, 4), "L5a", "L5b", "l6", "l7", "l9", "l10"];
const fileDiff = parseDiffFromFile(
	{ name: "cursor.ts", contents: `${original.join("\n")}\n` },
	{ name: "cursor.ts", contents: `${modified.join("\n")}\n` },
);

const down: CursorCommand = { kind: "move", direction: "down", extend: false };
const up: CursorCommand = { kind: "move", direction: "up", extend: false };
const left: CursorCommand = { kind: "move", direction: "left", extend: false };
const right: CursorCommand = { kind: "move", direction: "right", extend: false };
const extendDown: CursorCommand = { kind: "move", direction: "down", extend: true };

function at(line: number, side: DiffCursor["side"]): DiffCursorState {
	return { cursor: { line, side }, anchor: null };
}

function walk(layout: DiffCursorLayout, start: DiffCursorState, commands: CursorCommand[]) {
	const rows = diffCursorRows(fileDiff, layout);
	let state = start;
	const visited: string[] = [];
	for (const command of commands) {
		const outcome = diffCursorCommand(rows, layout, state, command);
		if (outcome.kind !== "state") throw new Error(`expected a state, got ${outcome.kind}`);
		state = outcome.state;
		visited.push(`${state.cursor.side === "deletions" ? "-" : "+"}${state.cursor.line}`);
	}
	return { state, visited };
}

describe("the diff line cursor", () => {
	test("walks the rows Pierre renders, the same lines review placement counts", () => {
		for (const layout of ["split", "unified"] as const) {
			const rows = diffCursorRows(fileDiff, layout);
			const rendered = renderedDiffLineNumbers(fileDiff);
			expect(new Set(rows.flatMap((row) => row.additions ?? []))).toEqual(
				new Set(rendered.additions),
			);
			expect(new Set(rows.flatMap((row) => row.deletions ?? []))).toEqual(
				new Set(rendered.deletions),
			);
		}
		expect(diffCursorRows(fileDiff, "split")).toHaveLength(11);
		expect(diffCursorRows(fileDiff, "unified")).toHaveLength(12);
	});

	test("collapsed unchanged context is not on the cursor's path", () => {
		const long = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
		const collapsed = parseDiffFromFile(
			{ name: "long.ts", contents: long },
			{ name: "long.ts", contents: long.replace("line 10", "changed 10") },
		);
		const rows = diffCursorRows(collapsed, "split");
		expect(rows.map((row) => row.additions)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
		const end = diffCursorCommand(rows, "split", at(10, "additions"), {
			kind: "edge",
			edge: "last",
			extend: false,
		});
		expect(end).toEqual({ kind: "state", state: at(14, "additions") });
	});

	test("starts on the first changed line, on its new side when it has one", () => {
		expect(initialDiffCursor(diffCursorRows(fileDiff, "split"), "split")).toEqual({
			line: 5,
			side: "additions",
		});
		expect(initialDiffCursor(diffCursorRows(fileDiff, "unified"), "unified")).toEqual({
			line: 5,
			side: "deletions",
		});
	});

	test("split: down and up skip the rows the cursor's side does not have", () => {
		expect(walk("split", at(5, "additions"), [down, down, down, down]).visited).toEqual([
			"+6",
			"+7",
			"+8",
			"+9",
		]);
		expect(walk("split", at(5, "deletions"), [down, down, down, up]).visited).toEqual([
			"-6",
			"-7",
			"-8",
			"-7",
		]);
	});

	test("split: left and right switch sides only where the row has the other side", () => {
		expect(walk("split", at(5, "additions"), [left, right]).visited).toEqual(["-5", "+5"]);
		expect(walk("split", at(6, "additions"), [left]).visited).toEqual(["+6"]);
		expect(walk("split", at(8, "deletions"), [right]).visited).toEqual(["-8"]);
	});

	test("unified: every row is a stop on its own side, and left / right do nothing", () => {
		expect(
			walk("unified", at(5, "deletions"), [down, down, down, down, down, left, right]).visited,
		).toEqual(["+5", "+6", "+7", "+8", "-8", "-8", "-8"]);
	});

	test("Home and End go to the first and last line of the cursor's side", () => {
		const rows = diffCursorRows(fileDiff, "split");
		const edge = (state: DiffCursorState, which: "first" | "last") =>
			diffCursorCommand(rows, "split", state, { kind: "edge", edge: which, extend: false });
		expect(edge(at(5, "additions"), "first")).toEqual({ kind: "state", state: at(1, "additions") });
		expect(edge(at(5, "deletions"), "last")).toEqual({ kind: "state", state: at(10, "deletions") });
	});

	test("Shift extends a range from where it started, and a comment takes that range", () => {
		const rows = diffCursorRows(fileDiff, "split");
		const { state } = walk("split", at(5, "additions"), [extendDown, extendDown]);
		expect(state).toEqual({
			cursor: { line: 7, side: "additions" },
			anchor: { line: 5, side: "additions" },
		});
		expect(diffCursorCommand(rows, "split", state, { kind: "comment" })).toEqual({
			kind: "comment",
			range: { start: 5, side: "additions", end: 7, endSide: "additions" },
		});
		expect(walk("split", state, [down]).state.anchor).toBeNull();
	});

	test("a unified range over a deleted and an added line spans both sides", () => {
		const rows = diffCursorRows(fileDiff, "unified");
		const { state } = walk("unified", at(5, "deletions"), [extendDown]);
		expect(diffCursorCommand(rows, "unified", state, { kind: "comment" })).toEqual({
			kind: "comment",
			range: { start: 5, side: "deletions", end: 5, endSide: "additions" },
		});
	});

	test("Escape clears a range first, then leaves the diff", () => {
		const rows = diffCursorRows(fileDiff, "split");
		const ranged = {
			cursor: { line: 7, side: "additions" as const },
			anchor: at(5, "additions").cursor,
		};
		expect(diffCursorCommand(rows, "split", ranged, { kind: "escape" })).toEqual({
			kind: "state",
			state: { cursor: ranged.cursor, anchor: null },
		});
		expect(diffCursorCommand(rows, "split", at(7, "additions"), { kind: "escape" })).toEqual({
			kind: "leave",
		});
	});

	test("names the cursor's place among its side's stops and the text of its line", () => {
		const split = diffCursorRows(fileDiff, "split");
		expect(diffCursorStop(split, "split", { line: 5, side: "additions" })).toEqual({
			position: 5,
			size: 10,
		});
		expect(diffCursorStop(split, "split", { line: 8, side: "deletions" })).toEqual({
			position: 8,
			size: 10,
		});
		const unified = diffCursorRows(fileDiff, "unified");
		expect(diffCursorStop(unified, "unified", { line: 5, side: "additions" })).toEqual({
			position: 6,
			size: 12,
		});
		expect(diffCursorStop(unified, "unified", { line: 8, side: "deletions" })).toEqual({
			position: 10,
			size: 12,
		});
		expect(diffLineText(fileDiff, { line: 5, side: "additions" })).toBe("L5a");
		expect(diffLineText(fileDiff, { line: 8, side: "deletions" })).toBe("l8");
		expect(diffLineText(fileDiff, { line: 42, side: "additions" })).toBe("");
	});

	test("a cursor whose line left the diff snaps to the nearest line of its side", () => {
		const rows = diffCursorRows(fileDiff, "split");
		expect(snapDiffCursor(rows, "split", { line: 42, side: "additions" })).toEqual({
			line: 10,
			side: "additions",
		});
		const unified = diffCursorRows(fileDiff, "unified");
		expect(snapDiffCursor(unified, "unified", { line: 6, side: "deletions" })).toEqual({
			line: 5,
			side: "deletions",
		});
		expect(snapDiffCursor(rows, "split", null)).toEqual({ line: 5, side: "additions" });
	});
});
