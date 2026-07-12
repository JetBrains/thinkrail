import { expect, test } from "bun:test";
import { isChunkLoadError, keysEqual } from "./ErrorBoundary";

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

// `keysEqual` gates auto-recovery: a caught error clears only when the resetKeys array changes
// (wired to workspace/tab id), so a stale key must read as equal and a changed one as unequal.
test("resetKeys recovery: equal keys keep the error, a changed key clears it", () => {
	// A changed value in the array → not equal → boundary resets and re-renders children.
	expect(keysEqual(["ws-1"], ["ws-2"])).toBe(false);
	expect(keysEqual([1, "tab-a"], [1, "tab-b"])).toBe(false);
	// Same values (even across distinct array instances) → equal → error stays until identity changes.
	expect(keysEqual(["ws-1"], ["ws-1"])).toBe(true);
	const same: readonly unknown[] = ["ws-1"];
	expect(keysEqual(same, same)).toBe(true);
});

test("resetKeys recovery: undefined and length changes are handled", () => {
	expect(keysEqual(undefined, undefined)).toBe(true); // no resetKeys on either side → never auto-resets
	expect(keysEqual(undefined, ["ws-1"])).toBe(false);
	expect(keysEqual(["ws-1"], undefined)).toBe(false);
	expect(keysEqual([], [])).toBe(true);
	expect(keysEqual(["ws-1"], ["ws-1", "ws-2"])).toBe(false);
	// `Object.is` semantics: NaN equals NaN, +0 ≠ -0.
	expect(keysEqual([Number.NaN], [Number.NaN])).toBe(true);
	expect(keysEqual([0], [-0])).toBe(false);
});
