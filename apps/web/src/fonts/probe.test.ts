import { expect, test } from "bun:test";
import { classifyWeightResponse } from "./probe";

test("ink that moves both ways is smooth, one way steps, and none is fixed", () => {
	expect(classifyWeightResponse(900, 1000, 1150)).toBe("smooth");
	expect(classifyWeightResponse(1000, 1000, 1150)).toBe("steps");
	expect(classifyWeightResponse(900, 1000, 1000)).toBe("steps");
	expect(classifyWeightResponse(1000, 1000, 1000)).toBe("fixed");
});
