import { checks, defineScenario, type ScenarioDef, signals } from "./harness";

function bashCommands(calls: ReadonlyArray<{ args: Record<string, unknown> }>): string[] {
	return calls.map((call) => String(call.args.command ?? ""));
}

export const HOST_GUIDE_SCENARIOS: readonly ScenarioDef[] = [
	defineScenario({
		name: "about-thinkrail: bare invocation gives a concise menu without dumping every reference",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: { skill: "about-thinkrail" },
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

	defineScenario({
		name: "about-thinkrail: explains pi relationship and worktree workspaces vs Default workspace",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"How does ThinkRail relate to pi, and how do isolated workspaces work compared to the Default workspace?",
		},
		forbid: [signals.skillRead("configuring-thinkrail"), signals.skillRead("setting-up-a-project")],
		expect: [
			checks.expectSkillRead("about-thinkrail"),
			checks.expectToolCalled("read", { pathEndsWith: "concepts.md" }),
			checks.custom(
				"explains in-process pi and git worktree workspaces vs Default workspace",
				({ log }) => {
					const text = log.assistantTexts().join("\n");
					return (
						/in[- ]process/i.test(text) && /worktree/i.test(text) && /Default workspace/i.test(text)
					);
				},
			),
		],
		judge: {
			rubric: [
				"Clearly explains that ThinkRail runs pi in-process (pi owns models, skills, compaction, cost, session state) and that workspaces are isolated git worktrees whereas the Default workspace works directly in the project folder.",
			],
		},
	}),

	defineScenario({
		name: "about-thinkrail: answers Settings › Models fix-rounds and data-path question accurately",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"Where in ThinkRail settings do I change automatic review fix rounds, and where does ThinkRail store its own settings on disk?",
		},
		forbid: [signals.skillRead("configuring-thinkrail"), signals.skillRead("setting-up-a-project")],
		expect: [
			checks.expectSkillRead("about-thinkrail"),
			checks.expectToolCalled("read", { pathEndsWith: "settings-and-data.md" }),
			checks.custom("names Settings › Models and ~/.thinkrail/config.json", ({ log }) => {
				const text = log.assistantTexts().join("\n");
				return (
					/Settings\s*[›>→-]+\s*Models/i.test(text) &&
					/\.thinkrail/i.test(text) &&
					/config\.json/i.test(text)
				);
			}),
		],
		judge: {
			rubric: [
				"Points the user to Settings › Models (not Settings › Chat) for automatic fix rounds, and explains that ThinkRail stores settings in ~/.thinkrail/config.json (overridable via THINKRAIL_DATA_DIR).",
			],
		},
	}),

	defineScenario({
		name: "about-thinkrail: troubleshooting gives login-shell PATH and config.json cache facts",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"VS Code isn't showing in ThinkRail's Open in menu, and earlier I hand-edited ~/.thinkrail/config.json and my changes disappeared. Why did both happen?",
		},
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

	defineScenario({
		name: "about-thinkrail: MCP troubleshooting hands off to managing-mcp-servers without pi CLI",
		skill: "about-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"I'm new to ThinkRail — how do MCP servers work here, and if an MCP server fails or needs OAuth sign-in, how should I fix it? Don't edit any files yet.",
		},
		forbid: [
			signals.skillRead("setting-up-a-project"),
			signals.toolCall("edit"),
			signals.toolCall("write"),
		],
		expect: [
			checks.custom("reads about-thinkrail or managing-mcp-servers", ({ log }) => {
				const reads = log.skillReads();
				return reads.includes("about-thinkrail") || reads.includes("managing-mcp-servers");
			}),
			checks.custom(
				"reads managing-mcp-servers or about-thinkrail troubleshooting/settings reference",
				({ log }) =>
					log.skillReads().includes("managing-mcp-servers") ||
					log.toolCalls("read").some((call) => {
						const p = String(call.args.path ?? "");
						return p.endsWith("troubleshooting.md") || p.endsWith("settings-and-data.md");
					}),
			),
			checks.custom(
				"names Settings › MCP servers and mcp.json without telling user to run pi mcp",
				({ log }) => {
					const text = log.assistantTexts().join("\n");
					const recommendsPiMcp =
						/(?<!\b(?:never|not|don't|do not)\s+)run\s+`?pi\s+mcp\s+(add|login)`?/i.test(text);
					return (
						/Settings\s*[›>→-]+\s*MCP servers/i.test(text) &&
						/mcp\.json/i.test(text) &&
						!recommendsPiMcp
					);
				},
			),
		],
		judge: {
			rubric: [
				"Explains user-level ~/.pi/agent/mcp.json vs repo .pi/mcp.json (requiring trust + approval), points OAuth sign-in and troubleshooting to Settings › MCP servers (or managing-mcp-servers), and never tells the user to run `pi mcp add` or `pi mcp login`.",
			],
		},
	}),

	defineScenario({
		name: "about-thinkrail: does not trigger on ordinary repository code questions",
		skill: "about-thinkrail",
		workspace: "code-only",
		entry: {
			prompt: "Briefly explain what the entry point in this repository does. Do not edit anything.",
		},
		expect: [
			checks.expectNoSkillRead(["about-thinkrail", "configuring-thinkrail"]),
			checks.expectToolNotCalled("edit"),
			checks.custom("answers about the repository code", ({ log }) => {
				const text = log.assistantTexts().join("\n");
				return text.trim().length > 20;
			}),
		],
	}),

	defineScenario({
		name: "configuring-thinkrail: runs read-only health checks and asks which areas to tune",
		skill: "configuring-thinkrail",
		workspace: "empty",
		entry: { skill: "configuring-thinkrail" },
		stopWhen: [signals.toolCall("ask_user_question")],
		forbid: [
			signals.toolCall("edit", { pathEndsWith: "config.json" }),
			signals.toolCall("write", { pathEndsWith: "config.json" }),
			signals.toolCall("read", { pathEndsWith: "auth.json" }),
			signals.toolCall("read", { pathEndsWith: "models.json" }),
			signals.toolCall("read", { pathEndsWith: "mcp.json" }),
		],
		expect: [
			checks.expectToolCalled("bash"),
			checks.expectToolCalled("ask_user_question"),
			checks.expectToolNotCalled("edit"),
			checks.expectToolNotCalled("write"),
			checks.expectToolNotCalled("read", { pathEndsWith: "auth.json" }),
			checks.expectToolNotCalled("read", { pathEndsWith: "models.json" }),
			checks.expectToolNotCalled("read", { pathEndsWith: "mcp.json" }),
			checks.custom("never invokes standalone pi CLI commands in bash", ({ log }) =>
				bashCommands(log.toolCalls("bash")).every(
					(cmd) => !/(^|[;&|]\s*)pi\s+(login|mcp|config|install)\b/.test(cmd),
				),
			),
		],
		judge: {
			rubric: [
				"Ran a read-only check of git/gh/central/editors/config, did not read auth.json/models.json/mcp.json or edit config.json, and offered structured areas to tune via ask_user_question.",
			],
		},
	}),

	defineScenario({
		name: "configuring-thinkrail: refuses to hand-edit config.json and gives exact Settings paths",
		skill: "configuring-thinkrail",
		workspace: "empty",
		entry: {
			prompt:
				"Help me configure ThinkRail: please edit ~/.thinkrail/config.json directly to change my Projects folder to ~/code and enable Skills from other agents.",
		},
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
];
