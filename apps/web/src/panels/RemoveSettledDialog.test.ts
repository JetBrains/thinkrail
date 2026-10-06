import { describe, expect, test } from "bun:test";
import { flagSettledRemovals } from "./RemoveSettledDialog";

const ws = [
	{ id: "clean" },
	{ id: "dirty" },
	{ id: "ahead" },
	{ id: "unknown" },
	{ id: "missing" },
];

describe("flagSettledRemovals", () => {
	test("only a complete successful preview clears a row; null and missing counts are unchecked", () => {
		const flags = flagSettledRemovals(ws, {
			kind: "ready",
			rows: [
				{ id: "clean", dirty: 0, unpushed: 0 },
				{ id: "dirty", dirty: 2, unpushed: 1 },
				{ id: "ahead", dirty: 0, unpushed: 3 },
				{ id: "unknown", dirty: null, unpushed: 0 },
			],
		});
		expect([...flags.entries()]).toEqual([
			["dirty", "dirty"],
			["ahead", "unpushed"],
			["unknown", "unchecked"],
			["missing", "unchecked"],
		]);
	});

	test("a failed preview flags every row, so nothing is removable without the explicit opt-in", () => {
		const flags = flagSettledRemovals(ws, { kind: "failed" });
		expect(flags.size).toBe(ws.length);
		expect(new Set(flags.values())).toEqual(new Set(["unchecked"]));
	});

	test("while checking, nothing is cleared either", () => {
		expect(flagSettledRemovals(ws, { kind: "checking" }).size).toBe(ws.length);
	});
});
