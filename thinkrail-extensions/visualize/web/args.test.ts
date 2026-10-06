import { describe, expect, test } from "bun:test";
import { parseComparisonOptions } from "./args";

describe("parseComparisonOptions", () => {
	test("returns [] for non-array input", () => {
		expect(parseComparisonOptions(undefined)).toEqual([]);
		expect(parseComparisonOptions("nope")).toEqual([]);
	});

	test("reads all fields when present", () => {
		const [opt] = parseComparisonOptions([
			{
				name: "A",
				description: "d",
				pros: ["p"],
				cons: ["c"],
				recommended: true,
				mermaid: "graph LR;A-->B",
			},
		]);
		expect(opt?.name).toBe("A");
		expect(opt?.description).toBe("d");
		expect(opt?.pros).toEqual(["p"]);
		expect(opt?.cons).toEqual(["c"]);
		expect(opt?.recommended).toBe(true);
		expect(opt?.mermaid).toBe("graph LR;A-->B");
	});

	test("defaults missing fields safely", () => {
		const [opt] = parseComparisonOptions([{ name: "B" }]);
		expect(opt?.name).toBe("B");
		expect(opt?.description).toBeUndefined();
		expect(opt?.pros).toEqual([]);
		expect(opt?.cons).toEqual([]);
		expect(opt?.recommended).toBe(false);
		expect(opt?.mermaid).toBeUndefined();
	});

	test("filters non-string pros/cons and coerces recommended to a boolean", () => {
		const [opt] = parseComparisonOptions([
			{ name: "C", pros: ["ok", 3, null], recommended: "yes" },
		]);
		expect(opt?.pros).toEqual(["ok"]);
		expect(opt?.recommended).toBe(false);
	});

	test("treats non-object entries as empty options (keeps positions)", () => {
		const opts = parseComparisonOptions([null, 5, { name: "D" }]);
		expect(opts).toHaveLength(3);
		expect(opts[0]?.name).toBe("");
		expect(opts[2]?.name).toBe("D");
	});
});
