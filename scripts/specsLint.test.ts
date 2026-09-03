import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSpecsLintCheck } from "./check-specs";
import { DEFAULT_RULES, lintSpecs, SPEC_BUDGET_FIELD } from "./specsLint";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-specs-lint-"));
	roots.push(root);
	return root;
}

function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, content);
}

function frontmatter(id: string, type = "module-design", extra = ""): string {
	return `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\n${extra}---\n\n`;
}

function tokens(count: number): string {
	return Array.from({ length: count }, (_, index) => `w${index}`).join(" ");
}

function headings(count: number): string {
	return Array.from({ length: count }, (_, index) => `## Section ${index}\n\n`).join("\n");
}

function paragraphs(count: number, perBlock = 100): string {
	const blocks: string[] = [];
	let remaining = count;
	while (remaining > 0) {
		const size = Math.min(perBlock, remaining);
		blocks.push(tokens(size));
		remaining -= size;
	}
	return blocks.join("\n\n");
}

function lint(root: string, tracked?: string[]) {
	return lintSpecs(root, tracked === undefined ? {} : { trackedFiles: tracked });
}

test("word counting excludes frontmatter and fenced code, counts inline code and link text only", () => {
	const root = fixture();
	write(
		root,
		"SPEC.md",
		`${frontmatter("a")}## Boundary\n\nowns \`createServer\` plus [the wire](https://example.com/some/long/url).\n\n\`\`\`ts\nconst invisible = "${tokens(50)}";\n\`\`\`\n`,
	);
	const report = lint(root);
	expect(report.metrics[0]?.words).toBe(7);
});

test("budget: over the default 3000 words is a violation; heading count follows the words", () => {
	const root = fixture();
	write(root, "SPEC.md", `${frontmatter("a")}${headings(8)}${tokens(3100)}`);
	const report = lint(root);
	expect(report.violations.some((v) => v.message.includes("exceeds the 3000 budget"))).toBe(true);
});

test("spec-budget override raises the word budget within the hard ceiling", () => {
	const root = fixture();
	write(
		root,
		"SPEC.md",
		`${frontmatter("a", "module-design", `${SPEC_BUDGET_FIELD}: 4000\n`)}${headings(9)}${paragraphs(3500)}`,
	);
	const report = lint(root);
	expect(report.violations).toEqual([]);
	expect(report.metrics[0]?.budget).toBe(4000);
});

test("spec-budget override above the ceiling or malformed is a violation", () => {
	const root = fixture();
	write(
		root,
		"a/SPEC.md",
		`${frontmatter("a", "module-design", `${SPEC_BUDGET_FIELD}: 9999\n`)}${headings(2)}${tokens(100)}`,
	);
	write(
		root,
		"b/SPEC.md",
		`${frontmatter("b", "module-design", `${SPEC_BUDGET_FIELD}: lots\n`)}${headings(2)}${tokens(100)}`,
	);
	const report = lint(root);
	expect(report.violations.some((v) => v.path === "a/SPEC.md" && v.message.includes("hard ceiling"))).toBe(true);
	expect(report.violations.some((v) => v.path === "b/SPEC.md" && v.message.includes("not a positive integer"))).toBe(true);
});

test("block cap: a long paragraph is flagged", () => {
	const root = fixture();
	write(root, "SPEC.md", `${frontmatter("a")}## Decisions\n\n${tokens(200)}\n`);
	const report = lint(root);
	expect(report.violations.some((v) => v.message.includes("prose block(s) over 120 words"))).toBe(true);
});

test("block cap: nested list items are their own blocks, not the parent's", () => {
	const root = fixture();
	const parentLead = tokens(80);
	const nested = Array.from({ length: 6 }, (_, index) => `  - sub ${index} ${tokens(60)}`).join("\n");
	write(
		root,
		"SPEC.md",
		`${frontmatter("a")}## Decisions\n\n- parent ${parentLead}\n${nested}\n`,
	);
	const report = lint(root);
	expect(report.violations).toEqual([]);
	const metrics = report.metrics[0];
	expect(metrics?.worstBlock).toBeLessThanOrEqual(DEFAULT_RULES.maxBlockWords);
});

test("block cap: a top-level item absorbs its continuation paragraphs", () => {
	const root = fixture();
	write(
		root,
		"SPEC.md",
		`${frontmatter("a")}## Decisions\n\n- parent ${tokens(100)}\n\n  continuation ${tokens(100)}\n`,
	);
	const report = lint(root);
	expect(report.violations.some((v) => v.message.includes("prose block(s)"))).toBe(true);
});

test("heading density: one heading per 500 words, H1 does not count", () => {
	const root = fixture();
	write(root, "SPEC.md", `${frontmatter("a")}# Title\n\n## Only\n\n${tokens(1200)}`);
	const report = lint(root);
	expect(report.violations.some((v) => v.message.includes("section heading(s)"))).toBe(true);
});

test("task-specs are exempt from budgets but not from graph checks", () => {
	const root = fixture();
	write(
		root,
		".thinkrail/context/TASK-x.md",
		`${frontmatter("task-x", "task-spec", "references: [ghost]\n")}${tokens(5000)}`,
	);
	write(root, "SPEC.md", `${frontmatter("a")}## Boundary\n\n- **Owns:** things.\n`);
	const report = lint(root);
	expect(report.violations.some((v) => v.path.includes("TASK") && v.message.includes("budget"))).toBe(false);
	expect(report.violations.some((v) => v.path.includes("TASK") && v.message.includes("missing spec id `ghost`"))).toBe(true);
});

test("graph validity: dangling frontmatter links, duplicates, and cycles are violations", () => {
	const root = fixture();
	write(
		root,
		"a/SPEC.md",
		`${frontmatter("a", "module-design", "references: [ghost]\n")}## Boundary\n\n- **Owns:** a.\n`,
	);
	write(root, "b/SPEC.md", `${frontmatter("dup")}## Boundary\n\n- **Owns:** b.\n`);
	write(root, "c/SPEC.md", `${frontmatter("dup")}## Boundary\n\n- **Owns:** c.\n`);
	const report = lint(root);
	expect(report.violations.some((v) => v.message.includes("link to missing spec id `ghost`"))).toBe(true);
	expect(report.violations.some((v) => v.message.includes("duplicate spec id `dup`"))).toBe(true);
});

test("durable specs must not link task-spec ids; task-specs may link durable ones", () => {
	const root = fixture();
	write(root, ".thinkrail/context/TASK-x.md", `${frontmatter("task-x", "task-spec", "parent: a\n")}scratch\n`);
	write(
		root,
		"SPEC.md",
		`${frontmatter("a", "module-design", "implements: [task-x]\n")}## Boundary\n\n- **Owns:** a.\n`,
	);
	const report = lint(root);
	expect(
		report.violations.some((v) => v.path === "SPEC.md" && v.message.includes("durable spec links task-spec id")),
	).toBe(true);
	expect(report.violations.some((v) => v.path.includes("TASK") && v.message.includes("durable"))).toBe(false);
});

test("tracked-file scoping hides untracked scratch specs from the lint", () => {
	const root = fixture();
	write(root, "SPEC.md", `${frontmatter("a")}## Boundary\n\n- **Owns:** a.\n`);
	write(
		root,
		".thinkrail/context/TASK-x.md",
		`${frontmatter("task-x", "task-spec", "parent: a\n")}${tokens(6000)}`,
	);
	const untracked = lint(root);
	expect(untracked.files).toBe(2);
	const tracked = lint(root, ["SPEC.md"]);
	expect(tracked.files).toBe(1);
	expect(tracked.violations.some((v) => v.path.includes("TASK"))).toBe(false);
});

test("runner: warn-only exits 0 with violations; --enforce exits 1", () => {
	const root = fixture();
	write(root, "SPEC.md", `${frontmatter("a")}## Decisions\n\n${tokens(200)}\n`);
	write(root, "clean/SPEC.md", `${frontmatter("clean")}## Boundary\n\n- **Owns:** b.\n`);
	const trackedFiles = ["SPEC.md", "clean/SPEC.md"];
	const out: string[] = [];
	const err: string[] = [];
	const stdout = (line: string) => out.push(line);
	const stderr = (line: string) => err.push(line);
	expect(runSpecsLintCheck(root, { trackedFiles, stdout, stderr })).toBe(0);
	expect(out.join("\n")).toContain("warn-only");
	expect(runSpecsLintCheck(root, { enforce: true, trackedFiles, stdout, stderr })).toBe(1);
	expect(err.join("\n")).toContain("FAILED");
});
