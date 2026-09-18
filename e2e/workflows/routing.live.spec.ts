import { execFileSync } from "node:child_process";
import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";

test.afterAll(() => endAllSessions());

const SETUP_WORKERS = ["starting-a-new-project", "importing-a-codebase"];
const DIRECT_WORK_FORBIDDEN_SKILLS = [
	"choosing-a-workflow",
	"brainstorming",
	"setting-up-a-project",
	"shipping-a-pr",
	"spec-graph",
	"todos",
	...SETUP_WORKERS,
];
const DIRECT_WORK_FORBIDDEN_TOOLS = [
	"spec_grep",
	"spec_get",
	"spec_graph",
	"spec_create",
	"spec_update",
	"spec_delete",
	"spec_validate",
	"todo_list",
	"todo_write",
	"todo_add",
	"todo_update",
	"todo_remove",
	"todo_plan_summary",
];

function changedPaths(cwd: string): string[] {
	return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" })
		.split("\n")
		.filter(Boolean)
		.map((line) => line.slice(3));
}

workflowTest(
	defineScenario({
		name: "root router: decision-bearing feature request routes to brainstorming",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: {
			prompt:
				"Add progress reporting to the CLI for both humans and automation. I have not decided " +
				"the output format, default behavior, or compatibility contract yet.",
		},
		stopWhen: [signals.skillRead("brainstorming")],
		forbid: SETUP_WORKERS.map((name) => signals.skillRead(name)),
		expect: [
			checks.expectSkillRead("choosing-a-workflow"),
			checks.expectOrdering("choosing-a-workflow", "brainstorming"),
			checks.expectToolNotCalled("edit"),
		],
		judge: {
			rubric: [
				"The agent recognized unresolved user-visible behavior and routed to brainstorming before design or implementation work.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "root router: PR checks route to shipping-a-pr",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: { prompt: "Check CI on PR #42 and investigate any failing checks." },
		stopWhen: [signals.skillRead("shipping-a-pr")],
		forbid: [signals.skillRead("brainstorming"), signals.skillRead("setting-up-a-project")],
		expect: [
			checks.expectSkillRead("choosing-a-workflow"),
			checks.expectOrdering("choosing-a-workflow", "shipping-a-pr"),
		],
		judge: {
			rubric: [
				"The agent treated checking an existing PR as PR lifecycle work and routed to shipping-a-pr.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "root router: raw idea in an empty workspace routes to the setup family",
		skill: "choosing-a-workflow",
		workspace: "empty",
		entry: {
			prompt:
				"I have an idea for a brand-new project: a tiny web app that tracks my houseplants' " +
				"watering schedule. Let's get it going.",
		},
		stopWhen: [
			signals.skillRead("setting-up-a-project"),
			signals.skillRead("starting-a-new-project"),
		],
		forbid: [signals.skillRead("brainstorming"), signals.skillRead("importing-a-codebase")],
		expect: [
			checks.custom(
				"routed into the setup family (dispatcher or its empty-repo worker)",
				({ log }) =>
					log
						.skillReads()
						.some((name) => name === "setting-up-a-project" || name === "starting-a-new-project"),
			),
		],
		judge: {
			rubric: [
				"The agent classified this as project onboarding (empty workspace, raw idea) — not feature work — before routing.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "direct work: a pure question bypasses workflows and gets answered directly",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: {
			prompt: "What does this codebase do? Give me a short overview of its modules.",
		},
		forbid: DIRECT_WORK_FORBIDDEN_SKILLS.map((name) => signals.skillRead(name)),
		expect: [
			checks.expectNoSkillRead(DIRECT_WORK_FORBIDDEN_SKILLS),
			...DIRECT_WORK_FORBIDDEN_TOOLS.map((name) => checks.expectToolNotCalled(name)),
			checks.custom("the answer describes the image-resizing codebase", ({ log }) =>
				/resiz/i.test(log.assistantTexts().join("\n")),
			),
			checks.custom(
				"the question leaves the worktree unchanged",
				({ cwd }) => changedPaths(cwd).length === 0,
			),
		],
		judge: {
			rubric: [
				"The agent answered without a workflow-routing announcement or loading a worker skill.",
				"The overview is grounded in the repository's actual files (AGENTS.md / src modules).",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "direct work: a localized fully specified edit bypasses workflows",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: {
			prompt:
				"In src/resize/index.ts rename the files parameter to imagePaths without changing " +
				"behavior. Make no other changes.",
		},
		forbid: DIRECT_WORK_FORBIDDEN_SKILLS.map((name) => signals.skillRead(name)),
		expect: [
			checks.expectNoSkillRead(DIRECT_WORK_FORBIDDEN_SKILLS),
			...DIRECT_WORK_FORBIDDEN_TOOLS.map((name) => checks.expectToolNotCalled(name)),
			checks.custom(
				"only the requested file changed",
				({ cwd }) => changedPaths(cwd).join("\n") === "src/resize/index.ts",
			),
			checks.expectFile(
				"src/resize/index.ts",
				/resize\(imagePaths: string\[\]\)[\s\S]*void imagePaths/,
			),
		],
		judge: {
			rubric: [
				"The agent made the requested localized rename directly without workflow ceremony or behavior changes.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "dispatcher: empty workspace routes to starting-a-new-project",
		skill: "setting-up-a-project",
		workspace: "empty",
		entry: {
			skill: "setting-up-a-project",
			args: "I want to start a brand-new project here: a CLI that renames photos by their EXIF date.",
		},
		stopWhen: [signals.skillRead("starting-a-new-project")],
		forbid: [signals.skillRead("importing-a-codebase"), signals.skillRead("brainstorming")],
		expect: [
			checks.expectSkillRead("starting-a-new-project"),
			checks.expectNoSkillRead(["importing-a-codebase"]),
		],
		judge: {
			rubric: [
				"The agent classified the workspace as empty/near-empty (README-only) before routing to starting-a-new-project.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "dispatcher: code-only workspace routes to importing-a-codebase",
		skill: "setting-up-a-project",
		workspace: "code-only",
		entry: {
			skill: "setting-up-a-project",
			args: "This is an existing codebase without specs — set it up.",
		},
		stopWhen: [signals.skillRead("importing-a-codebase")],
		forbid: [signals.skillRead("starting-a-new-project"), signals.skillRead("brainstorming")],
		expect: [
			checks.expectSkillRead("importing-a-codebase"),
			checks.expectNoSkillRead(["starting-a-new-project"]),
		],
		judge: {
			rubric: [
				"The agent inspected the workspace (files and/or spec tools) and classified it as real source code without specs before routing.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "dispatcher: specced workspace gets the review/extend offer, no setup worker",
		skill: "setting-up-a-project",
		workspace: "specced",
		entry: { skill: "setting-up-a-project", args: "Set up this project." },
		forbid: [...SETUP_WORKERS, "brainstorming"].map((name) => signals.skillRead(name)),
		expect: [
			checks.expectNoSkillRead([...SETUP_WORKERS, "brainstorming"]),
			checks.expectToolNotCalled("write", { pathEndsWith: "goal-and-requirements.md" }),
			checks.expectToolNotCalled("spec_create"),
			checks.custom("the reply offers to review or extend the existing specs", ({ log }) =>
				/(?:review|extend).{0,60}(?:spec|graph)|(?:spec|graph).{0,60}(?:review|extend)/i.test(
					log.assistantTexts().join("\n"),
				),
			),
		],
		judge: {
			rubric: [
				"The agent recognized the existing spec graph and offered to review or extend it instead of redoing setup or routing to brainstorming.",
				"After the offer was declined (skipped), the agent stopped rather than proceeding uninvited.",
			],
		},
	}),
);
