import { describe, expect, test } from "bun:test";
import { deltaRequirements, matchesGlob, parseOpenspec, stageOf, taskLines } from "./parse";

const tree = (files: Record<string, string>) => ({
	files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

describe("taskLines (OpenSpec's counting, the recorded CLI as truth)", () => {
	test("fenced and multi-line-commented checkboxes count, a box on a comment's own line does not", () => {
		const lines = taskLines(
			[
				"```",
				"- [ ] fenced",
				"```",
				"<!--",
				"- [x] commented",
				"-->",
				"<!-- - [x] inline comment -->",
				"    - [ ] indented",
				"1) [X] ordered",
			].join("\n"),
		);
		expect(lines.map((line) => [line.text, line.done, line.line])).toEqual([
			["fenced", false, 2],
			["commented", true, 5],
			["indented", false, 8],
			["ordered", true, 9],
		]);
	});

	test("only x / X is done; links, wide boxes and plain bullets are no tasks; CRLF reads", () => {
		const lines = taskLines(
			"- [~] tilde\r\n- [] empty\r\n- [ x ] padded\r\n- [A](link)\r\n- [WIP] wide\r\n- plain\r\n- [ ](link) box",
		);
		expect(lines.map((line) => line.done)).toEqual([false, false, true, false]);
	});
});

test("stageOf: archived by location, else by the tracked tasks", () => {
	const at = (completed: number, total: number, archived = false) =>
		stageOf({ archived, tasks: { completed, total } });
	expect([at(0, 0), at(0, 3), at(1, 3), at(3, 3), at(1, 3, true)]).toEqual([
		"planning",
		"ready",
		"in-progress",
		"complete",
		"archived",
	]);
});

test("matchesGlob: globstar over zero or more folders, no dotfiles, braces and classes", () => {
	expect(matchesGlob("specs/**/*.md", "specs/auth/spec.md")).toBe(true);
	expect(matchesGlob("specs/**/*.md", "specs/a/b/spec.md")).toBe(true);
	expect(matchesGlob("specs/**/*.md", "specs/top.md")).toBe(true);
	expect(matchesGlob("specs/**/*.md", "specs/.hidden/spec.md")).toBe(false);
	expect(matchesGlob("specs/**/*.md", "other/spec.md")).toBe(false);
	expect(matchesGlob("tasks/*.md", "tasks/a/b.md")).toBe(false);
	expect(matchesGlob("{tasks,todo}/[ab]*.md", "todo/b1.md")).toBe(true);
});

test("deltaRequirements: fenced headers are skipped, sections fold case, REMOVED bullets and renames count", () => {
	expect(
		deltaRequirements(
			[
				"## Added Requirements ##",
				"### Requirement: One",
				"```",
				"### Requirement: Fenced",
				"```",
				"### Documentation Requirements",
				"## REMOVED Requirements",
				"- `### Requirement: Gone`",
				"## RENAMED Requirements",
				"- FROM: `### Requirement: Old`",
				"- TO: `### Requirement: New`",
				"- TO: `### Requirement: Unpaired`",
				"## Notes",
				"### Requirement: Orphan",
			].join("\n"),
		),
	).toEqual([
		{ operation: "ADDED", name: "One", text: "```\n### Requirement: Fenced\n```" },
		{ operation: "REMOVED", name: "Gone" },
		{ operation: "RENAMED", name: "Old → New" },
	]);
	expect(
		deltaRequirements(
			[
				"## MODIFIED Requirements",
				"### Requirement: Login",
				"The system SHALL log in.",
				"",
				"#### Scenario: a match",
				"- **WHEN** it matches",
				"- **THEN** a session starts",
				"#### Scenario: no match",
				"- **WHEN** it does not",
				"### Requirement: Bare",
			].join("\n"),
		),
	).toEqual([
		{
			operation: "MODIFIED",
			name: "Login",
			text: "The system SHALL log in.",
			scenarios: [
				{ name: "a match", text: "- **WHEN** it matches\n- **THEN** a session starts" },
				{ name: "no match", text: "- **WHEN** it does not" },
			],
		},
		{ operation: "MODIFIED", name: "Bare" },
	]);
	expect(deltaRequirements("# A full spec\n## Requirements\n### Requirement: X\n")).toBeNull();
});

describe("parseOpenspec", () => {
	test("the change's own schema, else config.yaml's, else spec-driven; an unknown one is reported", () => {
		const changes = parseOpenspec(
			tree({
				"openspec/config.yaml": "schema: spec-driven\n",
				"openspec/changes/a/proposal.md": "# A title\n\n## Why\n\nBecause.\n",
				"openspec/changes/b/.openspec.yaml": "schema: from-a-user-folder\n",
				"openspec/changes/b/tasks.md": "- [x] one\n- [ ] two\n",
				"openspec/changes/c/.openspec.yaml": "schema: [broken\n",
			}),
		);
		expect(
			changes.map((change) => [change.name, change.schema, change.error !== undefined]),
		).toEqual([
			["a", "spec-driven", false],
			["b", "from-a-user-folder", true],
			["c", "spec-driven", true],
		]);
		const [a, b] = changes;
		expect(a?.title).toBe("A title");
		expect(a?.summary).toBe("Because.");
		expect(a?.nextArtifact).toBe("specs");
		expect(b?.artifacts).toEqual([]);
		expect(b?.tasks).toEqual({ completed: 1, total: 2 });
	});

	test("archived changes by location keep their base name; hidden and loose entries are skipped", () => {
		const changes = parseOpenspec(
			tree({
				"openspec/changes/archive/2026-11-02-add-refunds/tasks.md": "- [ ] open\n",
				"openspec/changes/archive/.staging/proposal.md": "# hidden\n",
				"openspec/changes/.draft/proposal.md": "# hidden\n",
				"openspec/changes/README.md": "# not a change\n",
			}),
		);
		expect(changes.map((change) => [change.name, change.baseName, stageOf(change)])).toEqual([
			["2026-11-02-add-refunds", "add-refunds", "archived"],
		]);
	});

	test("skip_specs marks an unwritten specs artifact skipped, so tasks is not blocked by it", () => {
		const [change] = parseOpenspec(
			tree({
				"openspec/changes/x/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
				"openspec/changes/x/proposal.md": "# X\n",
				"openspec/changes/x/design.md": "# D\n",
			}),
		);
		expect(change?.artifacts.map((artifact) => [artifact.id, artifact.status])).toEqual([
			["proposal", "done"],
			["specs", "skipped"],
			["design", "done"],
			["tasks", "ready"],
		]);
	});

	test("a project's own spec-driven schema overrides the built-in one", () => {
		const [change] = parseOpenspec(
			tree({
				"openspec/schemas/spec-driven/schema.yaml":
					"name: spec-driven\nartifacts:\n  - id: brief\n    generates: brief.md\n",
				"openspec/changes/x/brief.md": "# Brief\n",
			}),
		);
		expect(change?.artifacts.map((artifact) => [artifact.id, artifact.status])).toEqual([
			["brief", "done"],
		]);
		expect(change?.isComplete).toBe(true);
	});
});
