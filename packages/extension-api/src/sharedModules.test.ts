import { describe, expect, it } from "bun:test";
import { SHARED_MODULE_EXPORTS, SHARED_SPECIFIERS } from "./installed";

describe("extension API v1's allow-list of shared exports", () => {
	it("lists every shared specifier, in order, and nothing else", () => {
		expect(Object.keys(SHARED_MODULE_EXPORTS)).toEqual([...SHARED_SPECIFIERS]);
	});

	it.each(Object.entries(SHARED_MODULE_EXPORTS))(
		"%s names sorted, distinct, public identifiers",
		(_specifier, names) => {
			expect(names.length).toBeGreaterThan(0);
			expect([...names]).toEqual([...new Set(names)].sort());
			for (const name of names) {
				expect(name).toMatch(/^[A-Za-z][\w$]*$/);
				expect(name).not.toMatch(/^(?:default|unstable_|experimental_)/);
			}
		},
	);
});
