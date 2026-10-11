import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { baselineEntries, censusFile } from "./compiler-census";

const FIXTURE = join(import.meta.dir, "fixture.tsx");

const body = (bails: boolean) =>
	`{ const ref = useRef(0); ${bails ? "ref.current = 1;" : ""} return <p />; }`;
const memoRow = (bails: boolean) => `memo(() => ${body(bails)})`;

const census = (source: string[]) =>
	censusFile(FIXTURE, ['import { memo, useRef } from "react";', ...source].join("\n"));
const entries = (source: string[]) => baselineEntries(census(source).bailouts);

describe("compiler census identities", () => {
	it("names a wrapped function after its binding, so an inserted sibling cannot take its key", () => {
		expect(entries([`export const First = ${memoRow(true)};`])).toEqual([
			"scripts/fixture.tsx First",
		]);
		expect(
			entries([
				`export const Second = ${memoRow(true)};`,
				`export const First = ${memoRow(false)};`,
			]),
		).toEqual(["scripts/fixture.tsx Second"]);
	});

	it("qualifies a nested function by its lexical owners", () => {
		const factory = (owner: string, bails: boolean) =>
			`export function ${owner}() { function Row() ${body(bails)} return Row; }`;
		expect(entries([factory("first", false), factory("second", true)])).toEqual([
			"scripts/fixture.tsx second.Row",
		]);
	});

	it("keys an unnamed function without its line", () => {
		const unnamed = `register(React.memo(() => ${body(true)}));`;
		expect(entries([unnamed])).toEqual(["scripts/fixture.tsx <anonymous>"]);
		expect(entries(["", unnamed])).toEqual(["scripts/fixture.tsx <anonymous>"]);
	});

	it("refuses compiler units it cannot tell apart", () => {
		expect(() => census([`export const rows = [${memoRow(true)}, ${memoRow(false)}];`])).toThrow(
			"two compiler units named memo(…)",
		);
	});
});
