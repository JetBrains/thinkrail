import { expect, test } from "bun:test";
import { shallowEqualArrays } from "../lib";
import { isChunkLoadError } from "./ErrorBoundary";

test("classifies failed dynamic imports (stale Vite chunk / 504) as chunk-load errors", () => {
	expect(
		isChunkLoadError(
			new Error("Failed to fetch dynamically imported module: http://localhost/src/panels/X.tsx"),
		),
	).toBe(true);
	expect(isChunkLoadError(new Error("504 (Outdated Optimize Dep)"))).toBe(true);
	expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
	expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
});

test("treats ordinary render errors as non-chunk (in-place retry, not reload)", () => {
	expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'title')"))).toBe(
		false,
	);
	expect(isChunkLoadError(new TypeError("x.localeCompare is not a function"))).toBe(false);
});

test("tolerates non-Error throwables", () => {
	expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(true);
	expect(isChunkLoadError(null)).toBe(false);
	expect(isChunkLoadError(undefined)).toBe(false);
});

test("resetKeys recovery: equal keys keep the error, a changed key clears it", () => {
	expect(shallowEqualArrays(["ws-1"], ["ws-2"])).toBe(false);
	expect(shallowEqualArrays([1, "tab-a"], [1, "tab-b"])).toBe(false);
	expect(shallowEqualArrays(["ws-1"], ["ws-1"])).toBe(true);
	expect(shallowEqualArrays(undefined, undefined)).toBe(true);
});
