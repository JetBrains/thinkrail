import { describe, expect, test } from "bun:test";
import { CACHED_DIFF_TEXT, CACHED_DIFFS, createDiffCache } from "./diffCache";

const side = (mark: string, share: number) => mark.repeat(CACHED_DIFF_TEXT * share);
const diffKey = (mark: string, share: number) => [
	side(mark, share / 2),
	side(mark.toUpperCase(), share / 2),
	false,
];

function counted() {
	const cache = createDiffCache<number>();
	let computed = 0;
	const compute = () => ++computed;
	return {
		lookup: (key: readonly unknown[]) => cache(key, compute),
		computed: () => computed,
	};
}

describe("createDiffCache", () => {
	test("reuses a finished diff for an equal key, as a restarted render does", () => {
		const cache = createDiffCache<{ id: number }>();
		let computed = 0;
		const compute = () => ({ id: ++computed });
		const first = cache(["before".repeat(2), "after", false], compute);
		expect(cache(["beforebefore", "after", false], compute)).toBe(first);
		expect(cache(["beforebefore", "after", true], compute)).not.toBe(first);
		expect(computed).toBe(2);
	});

	test("holds a Changes viewport of small diffs, dropping the least recently used past the count", () => {
		const cache = counted();
		for (let index = 0; index < CACHED_DIFFS; index += 1) cache.lookup([index]);
		cache.lookup([0]);
		cache.lookup([CACHED_DIFFS]);
		expect(cache.computed()).toBe(CACHED_DIFFS + 1);
		cache.lookup([0]);
		expect(cache.computed()).toBe(CACHED_DIFFS + 1);
		cache.lookup([1]);
		expect(cache.computed()).toBe(CACHED_DIFFS + 2);
	});

	test("drops the least recently used diffs once their texts exceed the budget", () => {
		const cache = counted();
		for (const mark of ["a", "b", "c", "d"]) cache.lookup(diffKey(mark, 1 / 4));
		cache.lookup(diffKey("a", 1 / 4));
		expect(cache.computed()).toBe(4);
		cache.lookup(diffKey("e", 1 / 4));
		for (const mark of ["e", "a", "d", "c"]) cache.lookup(diffKey(mark, 1 / 4));
		expect(cache.computed()).toBe(5);
		cache.lookup(diffKey("b", 1 / 4));
		expect(cache.computed()).toBe(6);
	});

	test("always keeps the newest diff, even one larger than the whole budget", () => {
		const cache = counted();
		cache.lookup(diffKey("a", 1 / 4));
		cache.lookup(diffKey("h", 3 / 2));
		cache.lookup(diffKey("h", 3 / 2));
		expect(cache.computed()).toBe(2);
		cache.lookup(diffKey("a", 1 / 4));
		expect(cache.computed()).toBe(3);
		cache.lookup(diffKey("h", 3 / 2));
		expect(cache.computed()).toBe(4);
	});
});
