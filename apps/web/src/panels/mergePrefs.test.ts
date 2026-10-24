import { expect, test } from "bun:test";
import { allowedMergeMethods, defaultMergeMethod } from "./mergePrefs";

test("the dialog lists what the repository allows, every method when it never said", () => {
	expect(allowedMergeMethods(["rebase", "merge"])).toEqual(["merge", "rebase"]);
	expect(allowedMergeMethods(undefined)).toEqual(["squash", "merge", "rebase"]);
	expect(allowedMergeMethods([])).toEqual(["squash", "merge", "rebase"]);
});

test("the last method used wins while still allowed, else squash → merge → rebase", () => {
	expect(defaultMergeMethod(["squash", "merge", "rebase"], "rebase")).toBe("rebase");
	expect(defaultMergeMethod(["squash", "merge"], "rebase")).toBe("squash");
	expect(defaultMergeMethod(["merge", "rebase"])).toBe("merge");
	expect(defaultMergeMethod(["rebase"], undefined)).toBe("rebase");
});
