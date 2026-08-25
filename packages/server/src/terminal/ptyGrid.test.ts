import { describe, expect, test } from "bun:test";
import { nudgePtyRedraw, type PtyGrid, resizePtyIfChanged } from "./ptyGrid";

describe("PTY grid", () => {
	test("same-grid resize is a no-op", () => {
		const calls: PtyGrid[] = [];
		const current = { cols: 80, rows: 24 };

		expect(
			resizePtyIfChanged({ resize: (cols, rows) => calls.push({ cols, rows }) }, current, {
				cols: 80,
				rows: 24,
			}),
		).toBe(false);
		expect(calls).toEqual([]);
		expect(current).toEqual({ cols: 80, rows: 24 });
	});

	test("a changed grid resizes once and advances the tracked size", () => {
		const calls: PtyGrid[] = [];
		const current = { cols: 80, rows: 24 };

		expect(
			resizePtyIfChanged({ resize: (cols, rows) => calls.push({ cols, rows }) }, current, {
				cols: 120,
				rows: 40,
			}),
		).toBe(true);
		expect(calls).toEqual([{ cols: 120, rows: 40 }]);
		expect(current).toEqual({ cols: 120, rows: 40 });
	});

	test("a failed resize leaves the tracked grid unchanged", () => {
		const current = { cols: 80, rows: 24 };

		expect(() =>
			resizePtyIfChanged(
				{
					resize: () => {
						throw new Error("resize failed");
					},
				},
				current,
				{ cols: 120, rows: 40 },
			),
		).toThrow("resize failed");
		expect(current).toEqual({ cols: 80, rows: 24 });
	});
});

describe("nudgePtyRedraw", () => {
	test("shrinks the column count immediately; restore is deferred, not immediate", () => {
		const calls: PtyGrid[] = [];
		const scheduled: (() => void)[] = [];
		const current = { cols: 80, rows: 24 };

		nudgePtyRedraw({ resize: (cols, rows) => calls.push({ cols, rows }) }, current, {
			schedule: (fn, ms) => {
				expect(ms).toBeGreaterThan(0);
				scheduled.push(fn);
			},
		});

		expect(calls).toEqual([{ cols: 79, rows: 24 }]);
		expect(current).toEqual({ cols: 80, rows: 24 });

		for (const fn of scheduled) fn();
		expect(calls).toEqual([
			{ cols: 79, rows: 24 },
			{ cols: 80, rows: 24 },
		]);
	});

	test("falls back to nudging rows when there is only one column", () => {
		const calls: PtyGrid[] = [];
		const scheduled: (() => void)[] = [];

		nudgePtyRedraw(
			{ resize: (cols, rows) => calls.push({ cols, rows }) },
			{ cols: 1, rows: 24 },
			{ schedule: (fn) => scheduled.push(fn) },
		);
		for (const fn of scheduled) fn();

		expect(calls).toEqual([
			{ cols: 1, rows: 23 },
			{ cols: 1, rows: 24 },
		]);
	});

	test("does nothing for a 1x1 grid", () => {
		const calls: PtyGrid[] = [];

		nudgePtyRedraw(
			{ resize: (cols, rows) => calls.push({ cols, rows }) },
			{ cols: 1, rows: 1 },
			{ schedule: () => calls.push({ cols: -1, rows: -1 }) },
		);

		expect(calls).toEqual([]);
	});

	test("skips the restore when a newer resize changed the grid during the delay", () => {
		const calls: PtyGrid[] = [];
		const scheduled: (() => void)[] = [];
		const pty = { resize: (cols: number, rows: number) => calls.push({ cols, rows }) };
		const current: PtyGrid = { cols: 46, rows: 21 };

		nudgePtyRedraw(pty, current, { schedule: (fn) => scheduled.push(fn) });
		resizePtyIfChanged(pty, current, { cols: 38, rows: 21 });
		for (const fn of scheduled) fn();

		expect(calls).toEqual([
			{ cols: 45, rows: 21 },
			{ cols: 38, rows: 21 },
		]);
		expect(current).toEqual({ cols: 38, rows: 21 });
	});

	test("skips the restore when the terminal is no longer live", () => {
		const calls: PtyGrid[] = [];
		const scheduled: (() => void)[] = [];

		nudgePtyRedraw(
			{ resize: (cols, rows) => calls.push({ cols, rows }) },
			{ cols: 80, rows: 24 },
			{ schedule: (fn) => scheduled.push(fn), isStillLive: () => false },
		);
		for (const fn of scheduled) fn();

		expect(calls).toEqual([{ cols: 79, rows: 24 }]);
	});
});
