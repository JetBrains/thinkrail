import { describe, expect, test } from "bun:test";
import { type PtyGrid, resizePtyIfChanged } from "./ptyGrid";

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
