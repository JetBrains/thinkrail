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

const ADR_0001 = [
	"# ADR 0001 — the resize pipeline stays pure",
	"",
	"Status: accepted.",
	"",
	"All filesystem access lives in `src/cli`; `src/resize` transforms buffers only. This keeps the",
	"pipeline unit-testable without fixtures.",
	"",
].join("\n");

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

const pathArg = (args: Record<string, unknown>): string =>
	String(args.path ?? args.file_path ?? "");

function offerMentions(ctx: CheckContext, pattern: RegExp): boolean {
	return ctx.log
		.toolCalls("ask_user_question")
		.flatMap((call) => (call.args.questions ?? []) as AskUserQuestionItem[])
		.some((q) => pattern.test(JSON.stringify(q.options)));
}

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

function specPathsOfType(cwd: string, type: string): string[] {
	const hits: string[] = [];
	const walk = (dir: string, prefix: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const path = join(dir, entry.name);
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(path, relative);
			else if (entry.name.endsWith(".md")) {
				const frontmatter = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
				if (frontmatter?.[1] && new RegExp(`^type:\\s*${type}\\s*$`, "m").test(frontmatter[1]))
					hits.push(relative);
			}
		}
	};
	walk(cwd, "");
	return hits;
}

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

const answerFirstOption = {
	match: () => true,
	answer: pickRecommended,
};

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
		stopWhen: [flowSettled(true)],
		forbid: [
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
			checks.custom("adoption offer lists the architecture doc", (ctx) =>
				offerMentions(ctx, /architecture/i),
			),
			checks.custom(
				"the plan file is never offered as a candidate",
				(ctx) => !offerMentions(ctx, /plan-phase-2/i),
			),
			checks.expectSpecValid("docs/architecture.md"),
			checks.expectFile(
				"docs/architecture.md",
				(content) => content.startsWith("---") && content.includes("The resize pipeline is pure"),
			),
			checks.custom("no new architecture-design node beside the adopted docs", ({ cwd }) =>
				specPathsOfType(cwd, "architecture-design").every(
					(path) => path === "docs/architecture.md" || path.startsWith("docs/adr/"),
				),
			),
			graphRootDrafted,
			checks.expectFile("docs/plan-phase-2.md", (content) => content === PLAN_DOC),
			checks.expectFile("CHANGELOG.md", (content) => content === CHANGELOG_MD),
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
			checks.custom(
				"no adoption offer over README/CHANGELOG/TODO",
				(ctx) => !offerMentions(ctx, /(README|CHANGELOG|TODO)/i),
			),
			checks.expectFile("README.md", (content) => content === README_MD),
			checks.expectFile("CHANGELOG.md", (content) => content === CHANGELOG_MD),
			checks.expectFile("TODO.md", (content) => content === TODO_MD),
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
