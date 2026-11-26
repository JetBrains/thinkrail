import { expect, test } from "bun:test";
import { nextToolbarFold } from "./ArtifactsToolbar";

test("an overflowing toolbar folds its secondary actions, then unfolds once the width it needed is back", () => {
	expect(nextToolbarFold(0, true, 250, undefined)).toBe(1);
	expect(nextToolbarFold(1, true, 200, 300)).toBe(1);
	expect(nextToolbarFold(1, false, 299, 300)).toBe(1);
	expect(nextToolbarFold(1, false, 300, 300)).toBe(0);
	expect(nextToolbarFold(0, false, 500, undefined)).toBe(0);
});
