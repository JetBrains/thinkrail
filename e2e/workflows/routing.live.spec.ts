import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";

test.afterAll(() => endAllSessions());

const SETUP_WORKERS = ["starting-a-new-project", "importing-a-codebase"];

workflowTest(
	defineScenario({
		name: "root router: feature request routes to brainstorming",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: {
			prompt: "Add a --verbose flag to the CLI that logs each resize step as it happens.",
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
				"The agent read the choosing-a-workflow skill and named brainstorming as its route before doing any design or implementation work.",
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
		name: "root router: a pure question routes to no workflow and gets answered directly",
		skill: "choosing-a-workflow",
		workspace: "code-only",
		entry: {
			prompt: "What does this codebase do? Give me a short overview of its modules.",
		},
		forbid: ["brainstorming", "setting-up-a-project", ...SETUP_WORKERS].map((name) =>
			signals.skillRead(name),
		),
		expect: [
			checks.expectNoSkillRead(["brainstorming", "setting-up-a-project", ...SETUP_WORKERS]),
			checks.custom("the answer describes the image-resizing codebase", ({ log }) =>
				/resiz/i.test(log.assistantTexts().join("\n")),
			),
			checks.expectToolNotCalled("edit"),
		],
		judge: {
			rubric: [
				"The agent declared in one line that no workflow skill covers this (or equivalent) and proceeded directly.",
				"The overview is grounded in the repository's actual files (AGENTS.md / src modules).",
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
		forbid: SETUP_WORKERS.map((name) => signals.skillRead(name)),
		expect: [
			checks.expectNoSkillRead(SETUP_WORKERS),
			checks.expectToolNotCalled("write", { pathEndsWith: "goal-and-requirements.md" }),
			checks.expectToolNotCalled("spec_create"),
			checks.custom("the reply acknowledges the existing specs", ({ log }) =>
				/spec/i.test(log.assistantTexts().join("\n")),
			),
		],
		judge: {
			rubric: [
				"The agent recognized the existing spec graph and offered to review/extend it (or pointed at brainstorming) instead of redoing setup.",
				"After the offer was declined (skipped), the agent stopped rather than proceeding uninvited.",
			],
		},
	}),
);
