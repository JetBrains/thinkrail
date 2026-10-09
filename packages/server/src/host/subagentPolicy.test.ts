import { expect, test } from "bun:test";
import { resolveSubagentMaxConcurrent, resolveSubagentsEnabled } from "./subagentPolicy";

test("workspace subagent overrides take precedence over the global default", () => {
	expect(resolveSubagentsEnabled(true, { subagentsOverride: "off" })).toBe(false);
	expect(resolveSubagentsEnabled(false, { subagentsOverride: "on" })).toBe(true);
});

test("an absent override inherits the global default and an unknown workspace fails closed", () => {
	expect(resolveSubagentsEnabled(true, {})).toBe(true);
	expect(resolveSubagentsEnabled(false, {})).toBe(false);
	expect(resolveSubagentsEnabled(true, undefined)).toBe(false);
});

test("a valid workspace limit overrides the global one; anything else falls back", () => {
	expect(resolveSubagentMaxConcurrent(4, { subagentMaxConcurrentOverride: 9 })).toBe(9);
	expect(resolveSubagentMaxConcurrent(6, {})).toBe(6);
	expect(resolveSubagentMaxConcurrent(6, undefined)).toBe(6);
	expect(resolveSubagentMaxConcurrent(6, { subagentMaxConcurrentOverride: 0 })).toBe(6);
	expect(resolveSubagentMaxConcurrent(6, { subagentMaxConcurrentOverride: 2.5 })).toBe(6);
	expect(resolveSubagentMaxConcurrent(99, {})).toBe(4);
});
