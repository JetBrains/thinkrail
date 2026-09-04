import { expect, test } from "bun:test";
import { resolveSubagentsEnabled } from "./subagentPolicy";

test("workspace subagent overrides take precedence over the global default", () => {
	expect(resolveSubagentsEnabled(true, { subagentsOverride: "off" })).toBe(false);
	expect(resolveSubagentsEnabled(false, { subagentsOverride: "on" })).toBe(true);
});

test("an absent override inherits the global default and an unknown workspace fails closed", () => {
	expect(resolveSubagentsEnabled(true, {})).toBe(true);
	expect(resolveSubagentsEnabled(false, {})).toBe(false);
	expect(resolveSubagentsEnabled(true, undefined)).toBe(false);
});
