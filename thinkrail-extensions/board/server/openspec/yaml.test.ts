import { describe, expect, test } from "bun:test";
import { parseYaml, upsertTopLevelKey, YamlError, yamlScalar } from "./yaml";

describe("parseYaml", () => {
	test("reads the change metadata OpenSpec writes, comments and extension keys included", () => {
		expect(
			parseYaml(
				"# a comment\nschema: spec-driven\ncreated: 2026-11-19\ngoal: 'Add it: now'\nskip_specs: true\nx-tracker: SB-5497 # trailing\nx-owner: {team: payments, size: 3}\naffected_areas: [api, \"web ui\"]\n",
			),
		).toEqual({
			schema: "spec-driven",
			created: "2026-11-19",
			goal: "Add it: now",
			skip_specs: true,
			"x-tracker": "SB-5497",
			"x-owner": { team: "payments", size: 3 },
			affected_areas: ["api", "web ui"],
		});
	});

	test("reads a schema's nested artifacts, block scalars and sequences under keys", () => {
		const schema = parseYaml(
			[
				"---",
				"name: research-first",
				"artifacts:",
				"  - id: plan",
				"    instruction: |",
				"      Write the plan.",
				"      # kept: block scalar text",
				"    requires: [research]",
				"  - id: tasks",
				'    generates: "tasks/*.md"',
				"    requires:",
				"    - plan",
				"apply:",
				"  tracks: null",
			].join("\n"),
		);
		expect(schema).toEqual({
			name: "research-first",
			artifacts: [
				{
					id: "plan",
					instruction: "Write the plan.\n# kept: block scalar text\n",
					requires: ["research"],
				},
				{ id: "tasks", generates: "tasks/*.md", requires: ["plan"] },
			],
			apply: { tracks: null },
		});
	});

	test("refuses what it does not read rather than guessing", () => {
		expect(() => parseYaml("key: [unclosed")).toThrow(YamlError);
		expect(() => parseYaml("key: 'open")).toThrow(YamlError);
		expect(() => parseYaml("a: 1\n   b: 2\n")).toThrow(YamlError);
		expect(() => parseYaml("key: &anchor value")).toThrow(YamlError);
	});
});

describe("upsertTopLevelKey", () => {
	const marker = { card: "TR-12", workspace: "ws-1" };

	test("appends the key and keeps every other line as written", () => {
		const text = "schema: spec-driven\n# keep me\ncreated: 2026-11-19\n";
		const next = upsertTopLevelKey(text, "x-thinkrail", marker);
		expect(next).toBe(`${text}x-thinkrail:\n  card: TR-12\n  workspace: ws-1\n`);
		expect(parseYaml(next)).toEqual({
			schema: "spec-driven",
			created: "2026-11-19",
			"x-thinkrail": marker,
		});
	});

	test("replaces the key in place, its nested lines included, and nothing after it", () => {
		const text =
			"schema: spec-driven\nx-thinkrail:\n  card: TR-1\n\n  workspace: old\n# next key's comment\ngoal: Ship\n";
		expect(upsertTopLevelKey(text, "x-thinkrail", marker)).toBe(
			"schema: spec-driven\nx-thinkrail:\n  card: TR-12\n  workspace: ws-1\n# next key's comment\ngoal: Ship\n",
		);
		expect(upsertTopLevelKey("x-thinkrail: {card: TR-1}\nschema: s\n", "x-thinkrail", marker)).toBe(
			"x-thinkrail:\n  card: TR-12\n  workspace: ws-1\nschema: s\n",
		);
	});

	test("keeps CRLF endings, adds a missing final newline and quotes what would not read back", () => {
		expect(upsertTopLevelKey("schema: s\r\ngoal: g", "x-thinkrail", { card: "TR-1" })).toBe(
			"schema: s\r\ngoal: g\r\nx-thinkrail:\r\n  card: TR-1\r\n",
		);
		expect(yamlScalar("TR-12")).toBe("TR-12");
		for (const tricky of ["true", "123", "a: b", "#x", "", "no", "with space"])
			expect(parseYaml(`k: ${yamlScalar(tricky)}`)).toEqual({ k: tricky });
	});

	test("writes into an empty file and before a document end marker", () => {
		expect(upsertTopLevelKey("", "x-thinkrail", { card: "A-1" })).toBe(
			"x-thinkrail:\n  card: A-1\n",
		);
		expect(upsertTopLevelKey("schema: s\n...\n", "x-thinkrail", { card: "A-1" })).toBe(
			"schema: s\nx-thinkrail:\n  card: A-1\n...\n",
		);
	});
});
