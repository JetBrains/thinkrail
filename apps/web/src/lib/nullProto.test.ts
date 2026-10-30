import { expect, test } from "bun:test";
import { nullProto } from "./nullProto";

test("nullProto returns an empty object without a prototype", () => {
	const value = nullProto<Record<string, number>>();
	expect(Object.getPrototypeOf(value)).toBeNull();
	expect(Object.keys(value)).toEqual([]);
	expect("toString" in value).toBe(false);
});

test("nullProto merges sources left to right and skips undefined", () => {
	const base = nullProto<Record<string, number>>({ a: 1, b: 2 });
	const merged = nullProto<Record<string, number>>(base, undefined, { b: 3, c: 4 });
	expect(Object.getPrototypeOf(merged)).toBeNull();
	expect(merged).toEqual({ a: 1, b: 3, c: 4 });
	expect(base).toEqual({ a: 1, b: 2 });
});

test("nullProto keeps prototype-named keys as own data", () => {
	const value = nullProto<Record<string, string>>(
		JSON.parse('{"__proto__":"x","constructor":"y"}'),
	);
	expect(Object.getPrototypeOf(value)).toBeNull();
	expect(Object.hasOwn(value, "__proto__")).toBe(true);
	expect(value.constructor).toBe("y");
});
