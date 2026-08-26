import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { loadSpacing, validate } from "./spacing";

describe("validate spacing source shape", () => {
	it("accepts the committed source", () => {
		expect(validate(loadSpacing())).toEqual([]);
	});

	it("rejects non-object roots", () => {
		expect(validate(null)).toContain("spacing must be an object");
		expect(validate([])).toContain("spacing must be an object");
	});

	it("rejects properties outside the closed root and metadata shapes", () => {
		const source = loadSpacing();
		expect(validate({ ...source, unexpected: true })).toContain(
			'unknown spacing property "unexpected"',
		);
		expect(validate({ ...source, metadata: { ...source.metadata, unexpected: true } })).toContain(
			'unknown metadata property "unexpected"',
		);
	});

	it("rejects schema-invalid metadata and steps values", () => {
		const source = loadSpacing();
		expect(validate({ ...source, $schema: 42 })).toContain("$schema must be a string");
		expect(validate({ ...source, metadata: { version: "1.0.0", note: 42 } })).toContain(
			"metadata.note must be a string",
		);
		expect(validate({ ...source, steps: [] })).toContain("steps must be an object");
		expect(validate({ ...source, steps: {} })).toContain("steps must declare at least one step");
		expect(validate({ ...source, steps: { "8": 8 } })).toContain("steps.8 must be a string");
	});

	it("rejects leading-zero aliases for canonical step names", () => {
		const source = loadSpacing();
		expect(validate({ ...source, steps: { "08": "08px" } })).toContain(
			"steps.08 must be a canonical non-negative integer without leading zeros",
		);
	});

	it("keeps the editor schema aligned with the canonical step shape", () => {
		const schema = JSON.parse(
			readFileSync(new URL("../src/styles/spacing.schema.json", import.meta.url), "utf8"),
		) as {
			properties?: { steps?: { minProperties?: number; propertyNames?: { pattern?: string } } };
		};
		expect(schema.properties?.steps?.minProperties).toBe(1);
		expect(schema.properties?.steps?.propertyNames?.pattern).toBe("^(?:0|[1-9][0-9]*)$");
	});
});
