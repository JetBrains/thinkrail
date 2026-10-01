import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BASELINE_FILE,
	compareToBaseline,
	countFindings,
	readBaseline,
	runSpecLintCheck,
} from "./specLint";

const roots: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "spec-lint-"));
	roots.push(root);
	mkdirSync(join(root, "scripts"));
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function spec(root: string, rel: string, id: string, type: string, body: string): void {
	mkdirSync(join(root, rel, ".."), { recursive: true });
	writeFileSync(join(root, rel), `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\n---\n${body}`);
}

const CLEAN = "## Responsibility\n\nx\n\n## Boundary\n\ny\n";
const ONE_UNKNOWN = `${CLEAN}\n## Extra\n\nz\n`;
const TWO_UNKNOWN = `${ONE_UNKNOWN}\n## More\n\nw\n`;

function run(root: string, updateBaseline = false) {
	const out: string[] = [];
	const err: string[] = [];
	const code = runSpecLintCheck(root, {
		updateBaseline,
		stdout: (l) => out.push(l),
		stderr: (l) => err.push(l),
	});
	return { code, out: out.join("\n"), err: err.join("\n") };
}

test("countFindings groups per path and rule with sorted keys", () => {
	const counts = countFindings([
		{ rule: "words", path: "b/SPEC.md", line: 1, message: "" },
		{ rule: "bullet-length", path: "a/SPEC.md", line: 3, message: "" },
		{ rule: "bullet-length", path: "a/SPEC.md", line: 9, message: "" },
		{ rule: "lines", path: "a/SPEC.md", line: 1, message: "" },
	]);
	expect(JSON.stringify(counts)).toBe(
		'{"a/SPEC.md":{"bullet-length":2,"lines":1},"b/SPEC.md":{"words":1}}',
	);
});

test("compareToBaseline reports regressions and improvements, including vanished files", () => {
	const result = compareToBaseline(
		{ "a/SPEC.md": { lines: 1, words: 2 }, "c/SPEC.md": { bytes: 1 } },
		{ "a/SPEC.md": { lines: 1, words: 1 }, "b/SPEC.md": { lines: 3 } },
	);
	expect(result.regressions).toEqual([
		{ path: "a/SPEC.md", rule: "words", count: 2, allowed: 1 },
		{ path: "c/SPEC.md", rule: "bytes", count: 1, allowed: 0 },
	]);
	expect(result.improvements).toEqual([{ path: "b/SPEC.md", rule: "lines", count: 0, allowed: 3 }]);
});

test("the gate ratchets: fresh findings fail, --update-baseline freezes them, growth fails, cleanup demands tightening", () => {
	const root = makeRoot();
	spec(root, "a/SPEC.md", "a", "module-design", ONE_UNKNOWN);
	spec(root, "b/SPEC.md", "b", "submodule-design", CLEAN);

	const first = run(root);
	expect(first.code).toBe(1);
	expect(first.err).toContain("a/SPEC.md [unknown-section]: 1 (baseline 0)");
	expect(first.err).toContain(
		'a/SPEC.md:14 [unknown-section] "## Extra" is not a skeleton section',
	);

	const frozen = run(root, true);
	expect(frozen.code).toBe(0);
	expect(existsSync(join(root, BASELINE_FILE))).toBe(true);
	expect(readBaseline(root)).toEqual({ "a/SPEC.md": { "unknown-section": 1 } });
	expect(readFileSync(join(root, BASELINE_FILE), "utf8").endsWith("}\n")).toBe(true);

	const holds = run(root);
	expect(holds.code).toBe(0);
	expect(holds.out).toContain("baseline holds");

	spec(root, "a/SPEC.md", "a", "module-design", TWO_UNKNOWN);
	const grew = run(root);
	expect(grew.code).toBe(1);
	expect(grew.err).toContain("a/SPEC.md [unknown-section]: 2 (baseline 1)");
	expect(grew.err).toContain("--update-baseline");

	spec(root, "a/SPEC.md", "a", "module-design", CLEAN);
	const cleaned = run(root);
	expect(cleaned.code).toBe(1);
	expect(cleaned.err).toContain("looser than the specs");
	expect(cleaned.err).toContain("a/SPEC.md [unknown-section]: 0 (baseline 1)");

	expect(run(root, true).code).toBe(0);
	expect(readBaseline(root)).toEqual({});
	expect(run(root).code).toBe(0);
});

test("task-specs are ephemeral and never enter the gate or the baseline", () => {
	const root = makeRoot();
	spec(root, "a/SPEC.md", "a", "module-design", CLEAN);
	spec(
		root,
		".thinkrail/context/TASK-x.md",
		"task-x",
		"task-spec",
		"## Purpose\n\n- ".concat("very long ".repeat(200), "\n"),
	);
	const result = run(root);
	expect(result.code).toBe(0);
	expect(result.out).toContain("1 specs checked");
});
