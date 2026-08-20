import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";

test.afterAll(() => endAllSessions());

const TASK_SPEC = [
	"---",
	"id: task-verbose-logging",
	"type: task-spec",
	"status: draft",
	"title: Add a --verbose flag to the resize CLI",
	"---",
	"",
	"## Request",
	"",
	"Add a `--verbose` flag that logs each resize step as it happens.",
	"",
	"## Decisions (confirmed with user)",
	"",
	"1. Flag name: `--verbose` (long form only).",
	"2. Scope: per-file progress lines during the resize pipeline.",
	"",
	"## Open questions (round pending)",
	"",
	"- Log format: plain text lines or JSON objects? Ask the user via ask_user_question, then record",
	"  the answer under Decisions.",
	"",
	"## Next step",
	"",
	"Resolve the open question above in ONE ask_user_question round, record the decision in this file,",
	"and stop — do not start implementing.",
	"",
].join("\n");

workflowTest(
	defineScenario({
		name: "brainstorming mid-flow: resumes task-spec, asks one round, records the decision",
		skill: "brainstorming",
		workspace: "specced",
		preset: { artifacts: { "TASK-verbose-logging.md": TASK_SPEC } },
		user: {
			brief:
				"You are the developer who requested the --verbose flag for the resize CLI. You want plain-text " +
				"log lines (not JSON). Answer questions decisively and approve continuing; do not add new requirements.",
			opening:
				"Continue the brainstorming task in TASK-verbose-logging.md where we left off: resolve the open " +
				"question with me, record the decision in the task-spec, then stop.",
			maxUserTurns: 2,
		},
		dialog: { fallback: "pickRecommended" },
		stopWhen: [
			signals.toolCall("edit", {
				pathEndsWith: "TASK-verbose-logging.md",
				where: (call) => call.result !== undefined,
			}),
			signals.toolCall("write", {
				pathEndsWith: "TASK-verbose-logging.md",
				where: (call) => call.result !== undefined,
			}),
		],
		watchdog: { budget: { maxTurns: 6 } },
		expect: [
			checks.expectToolCalled("ask_user_question"),
			checks.expectFile("TASK-verbose-logging.md", (content) => content !== TASK_SPEC),
		],
		judge: {
			rubric: [
				"The agent asked the open log-format question via ask_user_question rather than deciding it alone.",
				"The user's answer was recorded in the task-spec before anything else was done.",
				"The agent did not start implementing the feature.",
			],
		},
		record: "brainstorming-mid-flow",
	}),
);

workflowTest(
	defineScenario({
		name: "transcript preset: reopened session continues mid-conversation",
		skill: "brainstorming",
		workspace: "empty",
		preset: { transcript: "brainstorming-mid-flow" },
		entry: {
			prompt:
				"Quick memory check — answer from our conversation only, without reading any files or using " +
				"any tools: which flag were we designing, and which log format did I settle on?",
		},
		stopWhen: [signals.turnEnd(1)],
		expect: [
			checks.custom(
				"assistant recalls the flag and the chosen format from the reopened transcript",
				({ log }) => {
					const text = log.assistantTexts().join("\n").toLowerCase();
					return text.includes("verbose") && text.includes("plain");
				},
			),
		],
		judge: {
			rubric: [
				"The assistant answered from conversation memory (the --verbose flag, plain-text format) without re-reading files.",
			],
		},
	}),
);
