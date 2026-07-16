// The routing suite (slice 2) — live classification coverage for the two routers, one scenario per row
// of their routing tables. Each run drives a REAL pi agent; pass verdicts are deterministic skill-load
// signals (the read of a worker's SKILL.md), aborted the moment they fire (cost control).
//
// Root router (choosing-a-workflow) — reached naturally via the always-on WORKFLOW_RULE:
//   feature/change → brainstorming · onboarding → the setup family · anything else → no workflow.
// Dispatcher (setting-up-a-project) — force-loaded via the app's exact `/skill:` seed (which injects the
// skill content directly, so no read of the dispatcher's own SKILL.md is expected):
//   empty → starting-a-new-project · code-only → importing-a-codebase · specced → review/extend, no worker.
//
// Needs pi auth; spends real tokens: bun run test:workflows
import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";

test.afterAll(() => endAllSessions());

const SETUP_WORKERS = ["starting-a-new-project", "importing-a-codebase"];

// ── Root router: work that changes the project → brainstorming ────────────────────────────────────────
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

// ── Root router: project onboarding → the setup family ────────────────────────────────────────────────
// The router's row names setting-up-a-project (the dispatcher); starting-a-new-project also carries a
// legitimate narrow self-trigger for unmistakable cases (family table) — either read is a correct route.
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

// ── Root router: anything else → no matching workflow ─────────────────────────────────────────────────
// A pure question changes nothing: no worker skill may load; the run completes normally (no stopWhen —
// the recorded contract makes the one-line no-workflow declaration judge territory, not a binding check).
//
// KNOWN LIMITATION (expected advisory-judge FAIL on rubric item 1, every run): the agent answers pure
// questions without reading choosing-a-workflow at all, so the router's one-line "no workflow covers
// this" declaration never happens — WORKFLOW_RULE's wording omits "question" while the router's own
// description claims it. Recorded in packages/pi-thinkrail-workflow/skills/SPEC.md § Current
// limitations & gaps ("Questions bypass the root router"); the rubric item deliberately stays so the
// drift is re-flagged on every run until the rule/router wording is reconciled in its own task.
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
			// The question was actually answered — the fixture is an image-resizing CLI.
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

// ── Dispatcher: empty / near-empty repo → starting-a-new-project ──────────────────────────────────────
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

// ── Dispatcher: real source, no specs → importing-a-codebase ──────────────────────────────────────────
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

// ── Dispatcher: specs already present → review/extend offer, never a setup worker ─────────────────────
// The dispatcher must not redo setup: it offers review/extend (or points at brainstorming). The default
// dialog fallback skips any offer round — declined → stop — so the run completes without drafting.
workflowTest(
	defineScenario({
		name: "dispatcher: specced workspace gets the review/extend offer, no setup worker",
		skill: "setting-up-a-project",
		workspace: "specced",
		entry: { skill: "setting-up-a-project", args: "Set up this project." },
		forbid: SETUP_WORKERS.map((name) => signals.skillRead(name)),
		expect: [
			checks.expectNoSkillRead(SETUP_WORKERS),
			// Setup must not be redone: no graph root drafted, no spec nodes created.
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
