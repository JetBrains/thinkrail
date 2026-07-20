// Slice-3 (partial): the importing-a-codebase worker end-to-end — the doc-adoption sub-flow.
//
// Two variants over the same small project (acme-widgets, the code-only shape):
//   1. docs-rich    — a real architecture doc + an ADR (candidates) and a finished plan file + CHANGELOG
//                     (traps). PASS = the adoption offer fires listing the architecture doc, accepted
//                     docs are adopted IN PLACE (frontmatter added, content preserved), the filled
//                     architecture slot is NOT drafted again, and the plan file is never offered nor
//                     touched.
//   2. no-candidates — only README/CHANGELOG/TODO besides code. PASS = the offer never fires, none of
//                     those files gain frontmatter, and the plain import path still drafts the graph.
//
// Binding verdicts are deterministic (files on disk + the captured ask_user_question args); the judge
// grades candidate classification quality advisorily. Needs pi auth; spends real tokens:
//   bun run test:workflows -- --grep "importing worker"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import type { AskUserQuestionItem, AskUserQuestionResult } from "@thinkrail/contracts";
import {
	type CheckContext,
	checks,
	defineScenario,
	endAllSessions,
	pickRecommended,
	type Signal,
	workflowTest,
} from "./harness";

test.afterAll(() => endAllSessions());

// ── Fixture content (inline — no *.md fixture files at rest) ──────────────────────────────────────────

const AGENTS_MD = [
	"# acme-widgets",
	"",
	"acme-widgets is a small command-line tool that batch-resizes images.",
	"",
	"## Modules",
	"- `src/cli` — argument parsing and the command entry point.",
	"- `src/resize` — the image-resizing pipeline (the core logic).",
	"",
	"`cli` calls `resize`; `resize` never imports `cli`.",
	"",
].join("\n");

const README_MD = "# acme-widgets\n\nBatch-resize images from the command line.\n";

// Candidate 1 — a durable, declarative architecture doc that matches the code. The "pipeline is pure"
// sentence is the preservation sentinel: it must survive adoption byte-for-byte.
const ARCHITECTURE_DOC = [
	"# Architecture",
	"",
	"acme-widgets is two modules with a one-way edge.",
	"",
	"- `src/cli` — argument parsing and the command entry point; the only module that talks to the user.",
	"- `src/resize` — the image-resizing pipeline (the core domain).",
	"",
	"`cli` depends on `resize`. `resize` never imports `cli`.",
	"",
	"The resize pipeline is pure: no filesystem access inside `src/resize`; the CLI owns all I/O.",
	"",
].join("\n");

// Candidate 2 — a decision record still in force.
const ADR_0001 = [
	"# ADR 0001 — the resize pipeline stays pure",
	"",
	"Status: accepted.",
	"",
	"All filesystem access lives in `src/cli`; `src/resize` transforms buffers only. This keeps the",
	"pipeline unit-testable without fixtures.",
	"",
].join("\n");

// Trap — a FINISHED implementation plan: never a candidate, never touched.
const PLAN_DOC = [
	"# Phase 2 rollout plan",
	"",
	"Status: completed 2026-05.",
	"",
	"- [x] Extract resize() into src/resize",
	"- [x] Wire CLI flags",
	"- [x] Ship v0.2",
	"",
].join("\n");

const CHANGELOG_MD = "# Changelog\n\n## 0.2.0\n\n- Extracted the resize module.\n";
const TODO_MD = "# TODO\n\n- [ ] add --verbose flag\n";

function seedAcme(cwd: string, opts: { withDocs: boolean }): void {
	writeFileSync(join(cwd, "AGENTS.md"), AGENTS_MD);
	writeFileSync(join(cwd, "README.md"), README_MD);
	writeFileSync(join(cwd, "CHANGELOG.md"), CHANGELOG_MD);
	mkdirSync(join(cwd, "src", "cli"), { recursive: true });
	mkdirSync(join(cwd, "src", "resize"), { recursive: true });
	writeFileSync(
		join(cwd, "src", "cli", "index.ts"),
		'import { resize } from "../resize";\n\nexport function main(argv: string[]): void {\n\tresize(argv);\n}\n',
	);
	writeFileSync(
		join(cwd, "src", "resize", "index.ts"),
		"// The core domain. Never imports from cli.\nexport function resize(files: string[]): void {\n\tvoid files;\n}\n",
	);
	if (opts.withDocs) {
		mkdirSync(join(cwd, "docs", "adr"), { recursive: true });
		writeFileSync(join(cwd, "docs", "architecture.md"), ARCHITECTURE_DOC);
		writeFileSync(join(cwd, "docs", "adr", "0001-pure-resize-pipeline.md"), ADR_0001);
		writeFileSync(join(cwd, "docs", "plan-phase-2.md"), PLAN_DOC);
	} else {
		writeFileSync(join(cwd, "TODO.md"), TODO_MD);
	}
}

// ── Shared predicates ──────────────────────────────────────────────────────────────────────────────────

const pathArg = (args: Record<string, unknown>): string =>
	String(args.path ?? args.file_path ?? "");

/** Every ask_user_question question whose OPTIONS mention `pattern` (candidates are offered as options). */
function offerMentions(ctx: CheckContext, pattern: RegExp): boolean {
	return ctx.log
		.toolCalls("ask_user_question")
		.flatMap((call) => (call.args.questions ?? []) as AskUserQuestionItem[])
		.some((q) => pattern.test(JSON.stringify(q.options)));
}

/**
 * The graph root is a FILENAME, not a fixed location (a real agent legitimately roots the graph in
 * docs/ — the browser import e2e makes the same allowance): search the workspace for it.
 */
function findGraphRoot(cwd: string): string | null {
	const walk = (dir: string): string | null => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				const hit = walk(path);
				if (hit) return hit;
			} else if (entry.name === "goal-and-requirements.md") return path;
		}
		return null;
	};
	return walk(cwd);
}

/** Count files in the tree whose spec frontmatter declares the given type. */
function countSpecsOfType(cwd: string, type: string): number {
	let count = 0;
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".md")) {
				const frontmatter = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
				if (frontmatter?.[1] && new RegExp(`^type:\\s*${type}\\s*$`, "m").test(frontmatter[1]))
					count += 1;
			}
		}
	};
	walk(cwd);
	return count;
}

/** Binding: a goal-and-requirements.md exists somewhere and is a well-formed spec (id + type). */
const graphRootDrafted = checks.custom(
	"graph root drafted (goal-and-requirements.md, any dir)",
	({ cwd }) => {
		const path = findGraphRoot(cwd);
		if (!path) return false;
		const frontmatter = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
		return (
			!!frontmatter?.[1] &&
			/^id:\s*\S+/m.test(frontmatter[1]) &&
			/^type:\s*\S+/m.test(frontmatter[1])
		);
	},
);

/**
 * Flow-settled stop signal — fires the moment the DETERMINISTIC outcome is decided (routing-suite
 * philosophy: abort for cost control, don't ride the flow to its natural end). That point is "the
 * graph root is drafted (+ the adoption landed, when expected)": every binding check is a filesystem
 * fact by then. Deliberately NOT gated on the skill's final spec_validate — it runs last (step 5) and
 * gating on it rode every run into the turn budget instead of a clean stop.
 */
function flowSettled(needsAdoption: boolean): Signal {
	return {
		description: needsAdoption ? "goal drafted + docs/architecture.md adopted" : "goal drafted",
		test: (log) => {
			const completed = (tool: string, suffix?: string): boolean =>
				log
					.toolCalls(tool)
					.some(
						(call) => call.result !== undefined && (!suffix || pathArg(call.args).endsWith(suffix)),
					);
			// The skill drafts via the spec tools (spec_create per node) — count every drafting tool.
			const goal = ["spec_create", "write", "edit"].some((tool) =>
				completed(tool, "goal-and-requirements.md"),
			);
			const adopted =
				completed("write", "docs/architecture.md") || completed("edit", "docs/architecture.md");
			return goal && (!needsAdoption || adopted);
		},
	};
}

const MAINTAINER_BRIEF =
	"You are the maintainer of acme-widgets setting up its spec graph. Be decisive and terse. " +
	"When asked which existing docs to include in the spec graph, include ALL offered candidates. " +
	"Answer intent questions from the README/AGENTS content (a CLI that batch-resizes images; no " +
	"non-goals worth adding). Never add new requirements. If the agent is mid-work, just say: continue.";

// Rounds are answered by SCRIPT rungs only (synchronous at tool_execution_start): a persona-rung
// answer is an LLM call, and the user simulator's next message can supersede the round while it
// composes — the delivery then fails (recorded on the round) and the scenario loses its answer.

/** Catch-all script rung: first option for every question — the deterministic interview answer. */
const answerFirstOption = {
	match: () => true,
	answer: pickRecommended,
};

/** Script rung: accept every offered candidate on the adoption question; first option elsewhere. */
const acceptAllCandidates = {
	match: (questions: AskUserQuestionItem[]) =>
		questions.some((q) => /architecture/i.test(JSON.stringify(q.options))),
	answer: (questions: AskUserQuestionItem[]): AskUserQuestionResult => ({
		answers: questions.map((q, i) =>
			/architecture/i.test(JSON.stringify(q.options))
				? {
						questionIndex: i,
						question: q.question,
						kind: "multi" as const,
						answer: null,
						selected: q.options.map((o) => o.label),
					}
				: {
						questionIndex: i,
						question: q.question,
						kind: "option" as const,
						answer: q.options[0]?.label ?? null,
					},
		),
		cancelled: false,
	}),
};

// ── Variant 1: docs-rich — the adoption offer fires and lands in place ────────────────────────────────

workflowTest(
	defineScenario({
		name: "importing worker: existing docs are offered and adopted in place",
		skill: "importing-a-codebase",
		workspace: (cwd) => seedAcme(cwd, { withDocs: true }),
		entry: {
			skill: "importing-a-codebase",
			args: "This is an existing codebase without specs — set up its spec graph.",
		},
		user: { brief: MAINTAINER_BRIEF, maxUserTurns: 3 },
		dialog: { script: [acceptAllCandidates, answerFirstOption], fallback: "pickRecommended" },
		// Each ask_user_question round costs extra turns (ack+terminate + the answer-triggered turn), so
		// the default 8-turn budget is too tight for a full import flow — hence maxTurns: 16 below.
		stopWhen: [flowSettled(true)],
		forbid: [
			// The finished plan is input at most — any write to it fails the run immediately.
			{
				description: "the plan file was modified",
				test: (log) =>
					["write", "edit"].some((tool) =>
						log.toolCalls(tool).some((call) => pathArg(call.args).endsWith("plan-phase-2.md")),
					),
			},
		],
		watchdog: { budget: { maxTurns: 16, maxToolCalls: 80 } },
		expect: [
			// The offer fired and listed the architecture doc as a candidate…
			checks.custom("adoption offer lists the architecture doc", (ctx) =>
				offerMentions(ctx, /architecture/i),
			),
			// …and never offered the finished plan.
			checks.custom(
				"the plan file is never offered as a candidate",
				(ctx) => !offerMentions(ctx, /plan-phase-2/i),
			),
			// Adopted in place: frontmatter added, sentinel prose preserved.
			checks.expectSpecValid("docs/architecture.md"),
			checks.expectFile(
				"docs/architecture.md",
				(content) => content.startsWith("---") && content.includes("The resize pipeline is pure"),
			),
			// The filled slot is not drafted again — the adopted doc is the ONLY architecture-design node.
			// (The pre-change skill drafted a parallel specs/architecture.md while docs/architecture.md sat
			// ignored — the exact duplication the adoption sub-flow exists to prevent.)
			checks.custom(
				"the adopted doc is the only architecture-design node",
				({ cwd }) => countSpecsOfType(cwd, "architecture-design") === 1,
			),
			// The rest of the graph still lands.
			graphRootDrafted,
			// Traps untouched, byte-for-byte.
			checks.expectFile("docs/plan-phase-2.md", (content) => content === PLAN_DOC),
			checks.expectFile("CHANGELOG.md", (content) => content === CHANGELOG_MD),
			// The ADR was not corrupted (adopted or not — its decision text survives).
			checks.expectFile("docs/adr/0001-pure-resize-pipeline.md", (content) =>
				content.includes("transforms buffers only"),
			),
		],
		judge: {
			rubric: [
				"Candidates were classified per the skill's boundary: the architecture doc and ADR treated as durable documents; the plan, changelog, and README treated as input only.",
				"The adoption question was folded into a single interview round rather than asked as a separate extra round.",
				"Adopted prose was not rewritten — no drift corrections were invented for a fixture whose docs match the code.",
				"The drafted graph is wired around the adopted architecture node (parent/links by id), not parallel to it.",
			],
		},
	}),
);

// ── Variant 2: no candidates — the offer must not fire; the plain path is unchanged ───────────────────

workflowTest(
	defineScenario({
		name: "importing worker: no candidate docs → no adoption offer, plain import",
		skill: "importing-a-codebase",
		workspace: (cwd) => seedAcme(cwd, { withDocs: false }),
		entry: {
			skill: "importing-a-codebase",
			args: "This is an existing codebase without specs — set up its spec graph.",
		},
		user: { brief: MAINTAINER_BRIEF, maxUserTurns: 3 },
		dialog: { script: [answerFirstOption], fallback: "pickRecommended" },
		stopWhen: [flowSettled(false)],
		forbid: [
			{
				description: "a non-candidate file (README/CHANGELOG/TODO) was modified",
				test: (log) =>
					["write", "edit"].some((tool) =>
						log
							.toolCalls(tool)
							.some((call) => /(README|CHANGELOG|TODO)\.md$/.test(pathArg(call.args))),
					),
			},
		],
		watchdog: { budget: { maxTurns: 16, maxToolCalls: 80 } },
		expect: [
			// Excluded kinds are never offered as spec-graph nodes.
			checks.custom(
				"no adoption offer over README/CHANGELOG/TODO",
				(ctx) => !offerMentions(ctx, /(README|CHANGELOG|TODO)/i),
			),
			// And never adopted: byte-identical to the seed.
			checks.expectFile("README.md", (content) => content === README_MD),
			checks.expectFile("CHANGELOG.md", (content) => content === CHANGELOG_MD),
			checks.expectFile("TODO.md", (content) => content === TODO_MD),
			// The plain import path still drafts the graph.
			graphRootDrafted,
		],
		judge: {
			rubric: [
				"The flow proceeded as a plain import: no adoption offer was manufactured for plan/process files.",
				"Any interview round asked only for intent the files could not reveal.",
			],
		},
	}),
);
