import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";

test.afterAll(() => endAllSessions());

function bashCommands(calls: ReadonlyArray<{ args: Record<string, unknown> }>): string[] {
	return calls.map((call) => String(call.args.command ?? ""));
}

workflowTest(
	defineScenario({
		name: "about-thinkrail: bare invocation gives a concise menu without dumping every reference",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: { skill: "about-thinkrail" },
		stopWhen: [signals.turnEnd(1)],
		forbid: [signals.skillRead("configuring-thinkrail"), signals.skillRead("setting-up-a-project")],
		expect: [
			checks.custom(
				"progressive disclosure: does not dump all 5 reference files on bare invocation",
				({ log }) => {
					const refReads = log
						.toolCalls("read")
						.filter((call) => String(call.args.path ?? "").includes("about-thinkrail/reference/"));
					return refReads.length < 3;
				},
			),
			checks.custom("mentions ThinkRail overview and offers topics or setup", ({ log }) => {
				const text = log.assistantTexts().join("\n");
				return (
					/ThinkRail/i.test(text) &&
					/(shortcut|setting|concept|setup|configuring-thinkrail)/i.test(text)
				);
			}),
		],
		judge: {
			rubric: [
				"The response is a crisp overview plus a scannable menu of topics to ask about, rather than a wall of text.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "about-thinkrail: answers Settings › Models fix-rounds and data-path question accurately",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"Where in ThinkRail settings do I change automatic review fix rounds, and where does ThinkRail store its own settings on disk?",
		},
		stopWhen: [signals.turnEnd(1)],
		forbid: [signals.skillRead("configuring-thinkrail"), signals.skillRead("setting-up-a-project")],
		expect: [
			checks.expectSkillRead("about-thinkrail"),
			checks.expectToolCalled("read", { pathEndsWith: "settings-and-data.md" }),
			checks.custom(
				"names Settings › Models (not Settings › Chat) and ~/.thinkrail/config.json",
				({ log }) => {
					const text = log.assistantTexts().join("\n");
					return (
						/Settings\s*[›>→-]+\s*Models/i.test(text) &&
						/\.thinkrail/i.test(text) &&
						/config\.json/i.test(text)
					);
				},
			),
		],
		judge: {
			rubric: [
				"Points the user to Settings › Models (not Settings › Chat) for automatic fix rounds, and explains that ThinkRail stores settings in ~/.thinkrail/config.json (overridable via THINKRAIL_DATA_DIR).",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "about-thinkrail: troubleshooting gives login-shell PATH and config.json cache facts",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"VS Code isn't showing in ThinkRail's Open in menu, and earlier I hand-edited ~/.thinkrail/config.json and my changes disappeared. Why did both happen?",
		},
		stopWhen: [signals.turnEnd(1)],
		forbid: [signals.skillRead("setting-up-a-project")],
		expect: [
			checks.expectSkillRead("about-thinkrail"),
			checks.expectToolCalled("read", { pathEndsWith: "troubleshooting.md" }),
			checks.custom(
				"explains code CLI on login-shell PATH and config.json in-memory cache",
				({ log }) => {
					const text = log.assistantTexts().join("\n");
					return (
						/\bcode\b/i.test(text) &&
						/login[- ]shell|PATH/i.test(text) &&
						/(cache|memory|overwrit)/i.test(text)
					);
				},
			),
		],
		judge: {
			rubric: [
				"Correctly explains that ThinkRail probes login-shell PATH for `code` (and does NOT tell the user to add PATH in Settings › Environment), and explains that config.json is cached in memory and overwritten on Settings saves.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "about-thinkrail: does not trigger on ordinary repository code questions",
		skill: "about-thinkrail",
		workspace: "code-only",
		entry: {
			prompt: "Briefly explain what the entry point in this repository does. Do not edit anything.",
		},
		stopWhen: [signals.turnEnd(1)],
		expect: [
			checks.expectNoSkillRead(["about-thinkrail", "configuring-thinkrail"]),
			checks.expectToolNotCalled("edit"),
		],
	}),
);

workflowTest(
	defineScenario({
		name: "configuring-thinkrail: runs read-only health checks and asks which areas to tune",
		skill: "configuring-thinkrail",
		workspace: "empty",
		entry: { skill: "configuring-thinkrail" },
		stopWhen: [signals.toolCall("ask_user_question"), signals.turnEnd(1)],
		forbid: [
			signals.toolCall("edit", { pathEndsWith: "config.json" }),
			signals.toolCall("write", { pathEndsWith: "config.json" }),
			signals.toolCall("read", { pathEndsWith: "auth.json" }),
		],
		expect: [
			checks.expectToolCalled("bash"),
			checks.expectToolNotCalled("edit"),
			checks.expectToolNotCalled("write"),
			checks.expectToolNotCalled("read", { pathEndsWith: "auth.json" }),
			checks.custom("never invokes standalone pi CLI commands in bash", ({ log }) =>
				bashCommands(log.toolCalls("bash")).every(
					(cmd) => !/(^|[;&|]\s*)pi\s+(login|mcp|config|install)\b/.test(cmd),
				),
			),
		],
		judge: {
			rubric: [
				"Ran a read-only check of git/gh/central/editors/config, did not read auth.json or edit config.json, and offered structured areas to tune.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "configuring-thinkrail: refuses to hand-edit config.json and gives exact Settings paths",
		skill: "configuring-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"Help me configure ThinkRail: please edit ~/.thinkrail/config.json directly to change my Projects folder to ~/code and enable Skills from other agents.",
		},
		stopWhen: [signals.turnEnd(1)],
		forbid: [
			signals.toolCall("edit", { pathEndsWith: "config.json" }),
			signals.toolCall("write", { pathEndsWith: "config.json" }),
		],
		expect: [
			checks.expectSkillRead("configuring-thinkrail"),
			checks.expectToolNotCalled("edit"),
			checks.expectToolNotCalled("write"),
			checks.custom(
				"points to Settings › Workspaces and Settings › Extensions & skills",
				({ log }) => {
					const text = log.assistantTexts().join("\n");
					return (
						/Settings\s*[›>→-]+\s*Workspaces/i.test(text) &&
						/Settings\s*[›>→-]+\s*Extensions\s*&\s*skills/i.test(text) &&
						/(cache|memory|overwrit|restart)/i.test(text)
					);
				},
			),
		],
		judge: {
			rubric: [
				"Refuses to hand-edit ~/.thinkrail/config.json because the running host caches and overwrites it, and directs the user to Settings › Workspaces and Settings › Extensions & skills.",
			],
		},
	}),
);

workflowTest(
	defineScenario({
		name: "boundary: project spec onboarding routes to setting-up-a-project, not configuring-thinkrail",
		skill: "setting-up-a-project",
		workspace: "code-only",
		entry: {
			prompt:
				"Help me set up this project with a spec graph so the agent understands the codebase.",
		},
		stopWhen: [signals.skillRead("setting-up-a-project")],
		forbid: [signals.skillRead("configuring-thinkrail"), signals.skillRead("about-thinkrail")],
		expect: [
			checks.expectSkillRead("setting-up-a-project"),
			checks.expectNoSkillRead(["configuring-thinkrail", "about-thinkrail"]),
		],
	}),
);
