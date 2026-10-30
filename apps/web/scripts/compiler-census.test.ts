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

	it("names a function expression after its variable, never its own id", () => {
		expect(entries([`export const Upper = function lower() ${body(true)};`])).toEqual([
			"scripts/fixture.tsx Upper",
		]);
		expect(
			entries([`export const x = function Fake() { function Row() ${body(true)} return Row; };`]),
		).toEqual(["scripts/fixture.tsx x.Row"]);
	});

	it("maps a diagnostic after multi-byte text to its function, line, and category", () => {
		const [bailout, ...rest] = census([
			'const label = "😀 émoji ü";',
			`export function Calm() ${body(false)}`,
			"export function useCounter() {",
			"\tconst ref = useRef(0);",
			"\tref.current = 1;",
			"\treturn ref;",
			"}",
		]).bailouts;
		expect(rest).toEqual([]);
		expect(bailout).toMatchObject({ fnName: "useCounter", line: 6, category: "Refs" });
	});

	it("ignores same-named helpers that neither call hooks nor render JSX", () => {
		expect(
			entries([
				"if (Math.random()) { const Label = () => 1; } else { const Label = () => 2; }",
				`export const Row = ${memoRow(true)};`,
			]),
		).toEqual(["scripts/fixture.tsx Row"]);
	});

	it("keys each child unit of a non-unit factory on its own", () => {
		const factory = (firstBails: boolean) =>
			`export function Factory() { function First() ${body(firstBails)} function Second() ${body(!firstBails)} return [First, Second]; }`;
		expect(entries([factory(true)])).toEqual(["scripts/fixture.tsx Factory.First"]);
		expect(entries([factory(false)])).toEqual(["scripts/fixture.tsx Factory.Second"]);
	});

	it("keys each child on its own when the outer function is not component-shaped", () => {
		const children = `function Head() ${body(true)} function Cell() ${body(true)}`;
		const expected = ["scripts/fixture.tsx Table.Cell", "scripts/fixture.tsx Table.Head"];
		// More than one prop argument, or returning an object, means the compiler skips `Table` itself.
		expect(
			entries([`export function Table(rows, columns) { ${children} return <table />; }`]),
		).toEqual(expected);
		expect(
			entries([`export function Table() { ${children} return { Head, Cell, el: <hr /> }; }`]),
		).toEqual(expected);
		expect(entries([`export function Row(props, forwardedRef = null) ${body(true)}`])).toEqual([
			"scripts/fixture.tsx Row",
		]);
	});

	it("follows the compiler past TypeScript wrappers and opt-in directives, and out of classes", () => {
		expect(
			entries([`export const Row = forwardRef(((props, forwardedRef) => ${body(true)}) as any);`]),
		).toEqual(["scripts/fixture.tsx Row"]);
		expect(
			entries([
				`export function helper() { "use memo"; const ref = useRef(0); ref.current = 1; return 1; }`,
			]),
		).toEqual(["scripts/fixture.tsx helper"]);
		expect(
			entries([
				`export class Panel { render() { function Row() { "use no memo"; return <p />; } return Row; } }`,
			]),
		).toEqual([]);
	});

	it("decides a component's shape by its last return only, as the compiler does", () => {
		expect(
			entries([`export function Row(p) { p.x = 1; if (p.a) return {}; return <p />; }`]),
		).toEqual(["scripts/fixture.tsx Row"]);
		const inner = `const Inner = () => ${body(true)};`;
		expect(
			entries([`export function Row(p) { ${inner} if (p.a) return <Inner />; return; }`]),
		).toEqual(["scripts/fixture.tsx Row.Inner"]);
	});

	it("counts JSX in a parameter default", () => {
		expect(
			entries([`export const Slot = ({ icon = <i /> }) => { icon.x = 1; return icon; };`]),
		).toEqual(["scripts/fixture.tsx Slot"]);
	});

	it("looks through TypeScript wrappers for memo arguments only", () => {
		expect(
			entries([
				`export const List = ((props) => { function Item() ${body(true)} return <Item />; }) as any;`,
			]),
		).toEqual(["scripts/fixture.tsx List.Item"]);
	});

	it("refuses a diagnostic it cannot place in a function", () => {
		const fileWide = [
			"/* eslint-disable react-hooks/exhaustive-deps */",
			"export function A({ a }) { return <p>{a}</p>; }",
		].join("\n");
		expect(() => censusFile(FIXTURE, fileWide)).toThrow("fixture.tsx:1: the compiler reported");
	});

	it("records units skipped by an opt-out directive, which the compiler does not report", () => {
		expect(entries([`export function Row() { "use no memo"; return <p />; }`])).toEqual([
			"scripts/fixture.tsx Row",
		]);
		expect(
			census([`export const Row = () => { "use no forget"; return <p />; };`]).bailouts,
		).toEqual([expect.objectContaining({ fnName: "Row", line: 2, category: "Skip" })]);
		const moduleOptOut = [
			'"use no memo";',
			'import { memo, useRef } from "react";',
			"export function A() { return <p />; }",
			`export const B = ${memoRow(false)};`,
		].join("\n");
		expect(baselineEntries(censusFile(FIXTURE, moduleOptOut).bailouts)).toEqual([
			"scripts/fixture.tsx A",
			"scripts/fixture.tsx B",
		]);
		expect(
			entries([`export function Outer() { function Inner() { "use no memo"; } return <p />; }`]),
		).toEqual([]);
	});

	it("refuses compiler units it cannot tell apart", () => {
		expect(() => census([`export const rows = [${memoRow(true)}, ${memoRow(false)}];`])).toThrow(
			"two compiler units named memo(…)",
		);
	});
});
