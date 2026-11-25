import type { AssistantMessage, Usage } from "@thinkrail/contracts";
import {
	defaultSessionDirFor,
	delegationSessionDirFor,
	type FixtureMessage,
	writeFixtureSession,
} from "@thinkrail/server/history-test-fixtures";
import { E2E_DATA_DIR, E2E_PI_AGENT_DIR } from "./paths";

export const E2E_EXTERNAL_CWD = "/tmp/thinkrail-e2e-external";

const BASE_TS = 1_700_000_000_000;

export function seedExternalCwdSessions(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = defaultSessionDirFor(agentDir, E2E_EXTERNAL_CWD);

	writeFixtureSession(dir, {
		id: "e2e-fixture-deploy-docs",
		cwd: E2E_EXTERNAL_CWD,
		messages: [
			{ role: "user", text: "deploy the docs site", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Deployed the docs site — all checks green.",
				timestamp: BASE_TS + 1_000,
			},
			{ role: "user", text: "fix the flaky watcher test", timestamp: BASE_TS + 2_000 },
			{
				role: "assistant",
				text: "Fixed it: the debounce window overlaps with the poll interval, so I widened it.",
				timestamp: BASE_TS + 3_000,
			},
		],
	});

	writeFixtureSession(dir, {
		id: "e2e-fixture-dependency-pins",
		cwd: E2E_EXTERNAL_CWD,
		messages: [{ role: "user", text: "update dependency pins", timestamp: BASE_TS + 10_000 }],
	});
}

export function seedWorkspaceSession(
	worktreePath: string,
	opts: Omit<Parameters<typeof writeFixtureSession>[1], "cwd">,
): { id: string; path: string } {
	const dir = defaultSessionDirFor(E2E_PI_AGENT_DIR, worktreePath);
	return writeFixtureSession(dir, { ...opts, cwd: worktreePath });
}

function spend(
	tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
	cost: number,
): Usage {
	const cacheRead = tokens.cacheRead ?? 0;
	const cacheWrite = tokens.cacheWrite ?? 0;
	return {
		input: tokens.input,
		output: tokens.output,
		cacheRead,
		cacheWrite,
		totalTokens: tokens.input + tokens.output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

const INSIGHTS_TS = 1_731_000_000_000;

type ToolArgs = Extract<AssistantMessage["content"][number], { type: "toolCall" }>["arguments"];
const PRICED = { provider: "anthropic", model: "claude-sonnet-4-5" } as const;

export const INSIGHTS_SESSIONS = {
	priced: { id: "e2e-insights-priced", title: "Refactor the retry helper" },
	unpriced: { id: "e2e-insights-unpriced", title: "Summarize the changelog" },
	delegating: { id: "e2e-insights-delegating", title: "Audit the retry paths" },
	child: { id: "e2e-insights-child" },
} as const;

export function seedInsightsSessions(workspace: { id: string; worktreePath: string }): {
	delegationDir: string;
} {
	const { priced, unpriced, delegating, child } = INSIGHTS_SESSIONS;
	const cwd = workspace.worktreePath;

	const pricedStart = INSIGHTS_TS + 2 * 3_600_000;
	seedWorkspaceSession(cwd, {
		id: priced.id,
		name: priced.title,
		messages: [
			{ role: "user", text: "refactor the retry helper", timestamp: pricedStart },
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "bash-1",
						name: "bash",
						arguments: { command: "bun test retry" },
					},
				],
				usage: spend({ input: 12_000, output: 800, cacheRead: 20_000, cacheWrite: 1_500 }, 0.31),
				stopReason: "toolUse",
				timestamp: pricedStart + 20_000,
				durationMs: 4_000,
			},
			{
				role: "toolResult",
				toolCallId: "bash-1",
				toolName: "bash",
				content: [
					{
						type: "text",
						text: "1 test failed: retries forever\nretry.test.ts:12 expected 3 attempts, got Infinity\nCommand exited with code 1",
					},
				],
				isError: true,
				timestamp: pricedStart + 40_000,
				durationMs: 15_000,
			},
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "bash-2",
						name: "bash",
						arguments: { command: "bun test retry" },
					},
				],
				usage: spend({ input: 2_000, output: 700, cacheRead: 8_000, cacheWrite: 500 }, 0.11),
				stopReason: "toolUse",
				timestamp: pricedStart + 60_000,
				durationMs: 3_000,
			},
			{
				role: "toolResult",
				toolCallId: "bash-2",
				toolName: "bash",
				content: [{ type: "text", text: "4 tests passed" }],
				isError: false,
				timestamp: pricedStart + 80_000,
				durationMs: 12_000,
			},
		],
	});

	const unpricedStart = INSIGHTS_TS + 3_600_000;
	seedWorkspaceSession(cwd, {
		id: unpriced.id,
		name: unpriced.title,
		messages: [
			{ role: "user", text: "summarize the changelog", timestamp: unpricedStart },
			{
				role: "assistant",
				provider: "claude-bridge",
				model: "claude-sonnet-4-5",
				text: "Three fixes and one new setting.",
				usage: spend({ input: 8_000, output: 900 }, 0),
				timestamp: unpricedStart + 30_000,
			},
		],
	});

	const delegationDir = delegationSessionDirFor(E2E_DATA_DIR, workspace.id, delegating.id);
	const childSpend = spend({ input: 3_000, output: 400 }, 0.25);
	writeFixtureSession(delegationDir, {
		id: child.id,
		cwd,
		messages: [
			{ role: "user", text: "audit the retry paths", timestamp: INSIGHTS_TS + 20_000 },
			{
				role: "assistant",
				...PRICED,
				text: "Two paths retry without a ceiling.",
				usage: childSpend,
				timestamp: INSIGHTS_TS + 50_000,
			},
		],
	});
	seedWorkspaceSession(cwd, {
		id: delegating.id,
		name: delegating.title,
		messages: [
			{ role: "user", text: "audit the retry paths with a subagent", timestamp: INSIGHTS_TS },
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "agent-1",
						name: "Agent",
						arguments: { subagent_type: "scout", task: "audit the retry paths" },
					},
				],
				usage: spend({ input: 1_000, output: 200 }, 0.05),
				stopReason: "toolUse",
				timestamp: INSIGHTS_TS + 10_000,
			},
			{
				role: "toolResult",
				toolCallId: "agent-1",
				toolName: "Agent",
				content: [{ type: "text", text: "Two paths retry without a ceiling." }],
				details: {
					childSessionId: child.id,
					task: "audit the retry paths",
					status: "completed",
					usage: {
						input: childSpend.input,
						output: childSpend.output,
						cacheRead: 0,
						cacheWrite: 0,
						cost: childSpend.cost.total,
						turns: 1,
						contextTokens: 0,
					},
					durationMs: 30_000,
				},
				isError: false,
				timestamp: INSIGHTS_TS + 60_000,
			},
			{
				role: "assistant",
				...PRICED,
				text: "The subagent found two unbounded retry paths.",
				usage: spend({ input: 500, output: 100 }, 0.02),
				timestamp: INSIGHTS_TS + 70_000,
			},
		],
	});

	return { delegationDir };
}

export const REPEAT_SESSION = { id: "e2e-insights-repeat", title: "Rerun the retry test" } as const;

/** One command run twice, passing then failing: one repeat group whose head is not the failure. */
export function seedRepeatSession(workspace: { worktreePath: string }): void {
	const start = INSIGHTS_TS + 4 * 3_600_000;
	const run = (n: number, at: number, failed: boolean) => [
		{
			role: "assistant" as const,
			...PRICED,
			content: [
				{
					type: "toolCall" as const,
					id: `bash-${n}`,
					name: "bash",
					arguments: { command: "bun test retry" },
				},
			],
			usage: spend({ input: 2_000, output: 300 }, 0.05),
			stopReason: "toolUse" as const,
			timestamp: start + at,
			durationMs: 2_000,
		},
		{
			role: "toolResult" as const,
			toolCallId: `bash-${n}`,
			toolName: "bash",
			content: [
				{
					type: "text" as const,
					text: failed
						? "1 test failed: flaky retry\nCommand exited with code 1"
						: "4 tests passed",
				},
			],
			isError: failed,
			timestamp: start + at + 10_000,
			durationMs: 8_000,
		},
	];
	seedWorkspaceSession(workspace.worktreePath, {
		id: REPEAT_SESSION.id,
		name: REPEAT_SESSION.title,
		messages: [
			{ role: "user", text: "rerun the retry test", timestamp: start },
			...run(1, 5_000, false),
			...run(2, 20_000, true),
		],
	});
}

export const TIMELINE_SESSIONS = {
	busy: { id: "e2e-insights-timeline", title: "Ship the timeline" },
	docs: { id: "e2e-insights-docs", title: "Review the docs" },
} as const;

/** Local noon-side times of one fixed day, so both sessions share a host-local day in any time zone. */
export const TIMELINE_DAY = { year: 2024, month: 10, date: 12, key: "2024-11-12" } as const;

function timelineAt(hour: number, seconds = 0): number {
	return (
		new Date(TIMELINE_DAY.year, TIMELINE_DAY.month, TIMELINE_DAY.date, hour).getTime() +
		seconds * 1000
	);
}

/**
 * Two sessions on one day for the turn cards, timeline and day view: the first has parallel reads, a
 * failing test run, a three-minute question to the user, a long wait for the next prompt and a turn
 * started by a background command's completion; the second is a short session that afternoon.
 */
export function seedTimelineSessions(workspace: { worktreePath: string }): void {
	const cwd = workspace.worktreePath;
	const at = (seconds: number) => timelineAt(10, seconds);
	seedWorkspaceSession(cwd, {
		id: TIMELINE_SESSIONS.busy.id,
		name: TIMELINE_SESSIONS.busy.title,
		messages: [
			{ role: "user", text: "plan the timeline view", timestamp: at(0) },
			{
				role: "assistant",
				...PRICED,
				content: [
					{ type: "toolCall", id: "read-a", name: "read", arguments: { path: "src/timeline.ts" } },
					{ type: "toolCall", id: "read-b", name: "read", arguments: { path: "src/lanes.ts" } },
				],
				usage: spend({ input: 9_000, output: 400, cacheRead: 12_000, cacheWrite: 900 }, 0.12),
				stopReason: "toolUse",
				timestamp: at(2),
				durationMs: 3_000,
			},
			{
				role: "toolResult",
				toolCallId: "read-a",
				toolName: "read",
				content: [{ type: "text", text: "export function lanes() {}" }],
				isError: false,
				timestamp: at(6.2),
				durationMs: 1_200,
			},
			{
				role: "toolResult",
				toolCallId: "read-b",
				toolName: "read",
				content: [{ type: "text", text: "export const tracks = 8;" }],
				isError: false,
				timestamp: at(6.5),
				durationMs: 1_500,
			},
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "bash-t",
						name: "bash",
						arguments: { command: "bun test timeline" },
					},
				],
				usage: spend({ input: 1_000, output: 300, cacheRead: 21_000, cacheWrite: 300 }, 0.05),
				stopReason: "toolUse",
				timestamp: at(8),
				durationMs: 2_000,
			},
			{
				role: "toolResult",
				toolCallId: "bash-t",
				toolName: "bash",
				content: [{ type: "text", text: "1 test failed\nCommand exited with code 1" }],
				isError: true,
				timestamp: at(14),
				durationMs: 4_000,
			},
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "ask-1",
						name: "ask_user_question",
						arguments: { question: "Keep the flaky test?" },
					},
				],
				usage: spend({ input: 500, output: 120, cacheRead: 22_000, cacheWrite: 100 }, 0.02),
				stopReason: "toolUse",
				timestamp: at(15),
				durationMs: 1_500,
			},
			{
				role: "toolResult",
				toolCallId: "ask-1",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Keep it" }],
				isError: false,
				timestamp: at(196.5),
				durationMs: 180_000,
			},
			{
				role: "assistant",
				...PRICED,
				text: "Kept the test and fixed the timing.",
				usage: spend({ input: 400, output: 200, cacheRead: 22_500, cacheWrite: 100 }, 0.02),
				stopReason: "stop",
				timestamp: at(198),
				durationMs: 2_500,
			},
			{ role: "user", text: "now run the build in the background", timestamp: at(1_200) },
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "bg-1",
						name: "background_command",
						arguments: { command: "bun run build" },
					},
				],
				usage: spend({ input: 600, output: 90, cacheRead: 22_800, cacheWrite: 80 }, 0.01),
				stopReason: "toolUse",
				timestamp: at(1_202),
				durationMs: 1_500,
			},
			{
				role: "toolResult",
				toolCallId: "bg-1",
				toolName: "background_command",
				content: [{ type: "text", text: "Started background command build" }],
				isError: false,
				timestamp: at(1_204),
				durationMs: 300,
			},
			{
				role: "assistant",
				...PRICED,
				text: "Started; I'll wait for it.",
				usage: spend({ input: 300, output: 40, cacheRead: 23_000, cacheWrite: 40 }, 0.01),
				stopReason: "stop",
				timestamp: at(1_205),
				durationMs: 800,
			},
			{
				role: "custom",
				customType: "background-command-completion",
				text: "Finished background command bun run build (exit 0)",
				details: { status: "finished", delivery: "wake" },
				timestamp: at(1_565),
			},
			{
				role: "assistant",
				...PRICED,
				text: "The build passed.",
				usage: spend({ input: 700, output: 60, cacheRead: 23_100, cacheWrite: 60 }, 0.01),
				stopReason: "stop",
				timestamp: at(1_566),
				durationMs: 1_200,
			},
		],
	});
	const docs = (seconds: number) => timelineAt(14, seconds);
	seedWorkspaceSession(cwd, {
		id: TIMELINE_SESSIONS.docs.id,
		name: TIMELINE_SESSIONS.docs.title,
		messages: [
			{ role: "user", text: "review the docs for stale links", timestamp: docs(0) },
			{
				role: "assistant",
				...PRICED,
				content: [{ type: "toolCall", id: "grep-1", name: "grep", arguments: { pattern: "http" } }],
				usage: spend({ input: 4_000, output: 200 }, 0.03),
				stopReason: "toolUse",
				timestamp: docs(3),
				durationMs: 2_000,
			},
			{
				role: "toolResult",
				toolCallId: "grep-1",
				toolName: "grep",
				content: [{ type: "text", text: "docs/a.md:3 http://old" }],
				isError: false,
				timestamp: docs(6),
				durationMs: 600,
			},
			{
				role: "assistant",
				...PRICED,
				text: "One stale link in docs/a.md.",
				usage: spend({ input: 300, output: 50 }, 0.01),
				stopReason: "stop",
				timestamp: docs(8),
				durationMs: 1_000,
			},
		],
	});
}

export const PLAN_SESSIONS = {
	release: { id: "e2e-insights-release", title: "Ship the release plan" },
	changelog: { id: "e2e-insights-review-changelog" },
	version: { id: "e2e-insights-review-version" },
} as const;

function todoItem(id: string, title: string, status: "pending" | "in_progress" | "done") {
	const at = new Date(INSIGHTS_TS).toISOString();
	return { id, title, status, origin: "agent", createdAt: at, updatedAt: at };
}

/**
 * A session with a pi-todos plan worked step by step, a skill read, a failing lint run retried with
 * `--write` after an edit, and a wave of two reviewer subagents spawned in one turn with transcripts.
 */
export function seedPlanSessions(workspace: { id: string; worktreePath: string }): {
	delegationDir: string;
} {
	const cwd = workspace.worktreePath;
	const { release, changelog, version } = PLAN_SESSIONS;
	const start = INSIGHTS_TS + 5 * 3_600_000;
	const at = (seconds: number) => start + seconds * 1000;
	const delegationDir = delegationSessionDirFor(E2E_DATA_DIR, workspace.id, release.id);
	for (const [child, area, offset] of [
		[changelog.id, "the changelog wording", 0],
		[version.id, "the version bump", 4],
	] as const) {
		writeFixtureSession(delegationDir, {
			id: child,
			cwd,
			messages: [
				{ role: "user", text: `Review ${area}`, timestamp: at(130 + offset) },
				{
					role: "assistant",
					...PRICED,
					content: [
						{
							type: "toolCall",
							id: `${child}-read`,
							name: "read",
							arguments: { path: "CHANGELOG.md" },
						},
					],
					usage: spend({ input: 2_000, output: 200 }, 0.04),
					stopReason: "toolUse",
					timestamp: at(140 + offset),
					durationMs: 4_000,
				},
				{
					role: "toolResult",
					toolCallId: `${child}-read`,
					toolName: "read",
					content: [{ type: "text", text: "## 1.2.0\n- fixes" }],
					isError: false,
					timestamp: at(150 + offset),
					durationMs: 800,
				},
				{
					role: "assistant",
					...PRICED,
					text: `Looks good: ${area} is consistent.`,
					usage: spend({ input: 2_500, output: 300 }, 0.05),
					stopReason: "stop",
					timestamp: at(170 + offset),
					durationMs: 5_000,
				},
			],
		});
	}
	const call = (
		seconds: number,
		id: string,
		name: string,
		args: ToolArgs,
		result: { text: string; isError?: boolean; details?: unknown },
	): FixtureMessage[] => [
		{
			role: "assistant",
			...PRICED,
			content: [{ type: "toolCall", id, name, arguments: args }],
			usage: spend({ input: 1_000, output: 100, cacheRead: 4_000 }, 0.02),
			stopReason: "toolUse",
			timestamp: at(seconds),
			durationMs: 2_000,
		},
		{
			role: "toolResult",
			toolCallId: id,
			toolName: name,
			content: [{ type: "text", text: result.text }],
			isError: result.isError ?? false,
			...(result.details === undefined ? {} : { details: result.details }),
			timestamp: at(seconds + 4),
			durationMs: 1_500,
		},
	];
	const plan = (
		statuses: [
			"pending" | "in_progress" | "done",
			"pending" | "in_progress" | "done",
			"pending" | "in_progress" | "done",
		],
	) => ({
		plan: {
			todos: [],
			groups: [
				{
					id: "g_0000000000a1",
					title: "Release",
					todos: [
						todoItem("t_0000000000b1", "Bump the version", statuses[0]),
						todoItem("t_0000000000b2", "Write the changelog", statuses[1]),
						todoItem("t_0000000000b3", "Tag the release", statuses[2]),
					],
				},
			],
		},
	});
	const childRun = (childSessionId: string) => ({
		childSessionId,
		task: "review",
		status: "completed",
		usage: {
			input: 4_500,
			output: 500,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.09,
			turns: 2,
			contextTokens: 0,
		},
		durationMs: 45_000,
	});
	seedWorkspaceSession(cwd, {
		id: release.id,
		name: release.title,
		messages: [
			{ role: "user", text: "ship the release with a plan", timestamp: at(0) },
			...call(
				5,
				"skill-1",
				"read",
				{ path: `${cwd}/.pi/skills/todos/SKILL.md` },
				{ text: "# todos skill" },
			),
			...call(
				15,
				"todo-1",
				"todo_write",
				{ groups: [{ title: "Release", todos: [] }] },
				{
					text: "Wrote the plan (3 item(s) total)",
					details: plan(["pending", "pending", "pending"]),
				},
			),
			...call(
				25,
				"todo-2",
				"todo_update",
				{ id: "t_0000000000b1", status: "in_progress" },
				{
					text: "Updated",
					details: {
						todo: todoItem("t_0000000000b1", "Bump the version", "in_progress"),
						paused: [],
					},
				},
			),
			...call(
				35,
				"lint-1",
				"bash",
				{ command: "bunx biome check src/version.ts" },
				{
					text: "src/version.ts:12:4 error: Forbidden non-null assertion.\nCommand exited with code 1",
					isError: true,
				},
			),
			...call(
				45,
				"edit-1",
				"edit",
				{ path: "src/version.ts", oldText: "version!", newText: "version" },
				{ text: "Successfully replaced 1 block" },
			),
			...call(
				55,
				"lint-2",
				"bash",
				{ command: "bunx biome check --write src/version.ts" },
				{ text: "Checked 1 file. Fixed 1 file." },
			),
			...call(
				65,
				"todo-3",
				"todo_update",
				{ id: "t_0000000000b1", status: "done" },
				{
					text: "Updated",
					details: { todo: todoItem("t_0000000000b1", "Bump the version", "done"), paused: [] },
				},
			),
			...call(
				75,
				"todo-4",
				"todo_update",
				{ id: "t_0000000000b2", status: "in_progress" },
				{
					text: "Updated",
					details: {
						todo: todoItem("t_0000000000b2", "Write the changelog", "in_progress"),
						paused: [],
					},
				},
			),
			{
				role: "assistant",
				...PRICED,
				content: [
					{ type: "text", text: "I'm spinning up two reviewers, one per area of the release." },
					{
						type: "toolCall",
						id: "agent-a",
						name: "Agent",
						arguments: {
							subagent_type: "reviewer",
							task: "You review the release.\n\nArea: the changelog wording",
						},
					},
					{
						type: "toolCall",
						id: "agent-b",
						name: "Agent",
						arguments: {
							subagent_type: "reviewer",
							task: "You review the release.\n\nArea: the version bump",
						},
					},
				],
				usage: spend({ input: 1_200, output: 300, cacheRead: 4_000 }, 0.03),
				stopReason: "toolUse",
				timestamp: at(120),
				durationMs: 3_000,
			},
			{
				role: "toolResult",
				toolCallId: "agent-a",
				toolName: "Agent",
				content: [{ type: "text", text: "The changelog wording is consistent." }],
				details: childRun(changelog.id),
				isError: false,
				timestamp: at(180),
			},
			{
				role: "toolResult",
				toolCallId: "agent-b",
				toolName: "Agent",
				content: [{ type: "text", text: "The version bump is consistent." }],
				details: childRun(version.id),
				isError: false,
				timestamp: at(185),
			},
			{
				role: "assistant",
				...PRICED,
				text: "Both reviews are back and clean.",
				usage: spend({ input: 800, output: 120, cacheRead: 4_200 }, 0.02),
				stopReason: "stop",
				timestamp: at(195),
				durationMs: 2_500,
			},
			...call(
				205,
				"todo-5",
				"todo_update",
				{ id: "t_0000000000b2", status: "done" },
				{
					text: "Updated",
					details: { todo: todoItem("t_0000000000b2", "Write the changelog", "done"), paused: [] },
				},
			),
		],
	});
	return { delegationDir };
}

export const CONTEXT_SESSIONS = {
	refactor: { id: "e2e-insights-context", title: "Refactor the parser and its docs" },
} as const;

const TOOL_DECLARATIONS = ["read", "edit", "write", "bash"].map((name) => ({
	name,
	description: `The ${name} tool.`,
	parameters: { type: "object", properties: {} },
}));

function cached(
	split: { input: number; cacheRead?: number; cacheWrite?: number; output?: number },
	cost: number,
): Usage {
	return spend(
		{
			input: split.input,
			output: split.output ?? 300,
			cacheRead: split.cacheRead ?? 0,
			cacheWrite: split.cacheWrite ?? 0,
		},
		cost,
	);
}

function editPatch(path: string, added: number, removed: number): string {
	return [
		`--- ${path}`,
		`+++ ${path}`,
		"@@ -3,2 +3,2 @@",
		...Array.from({ length: removed }, (_, at) => `-const old${at} = ${at};`),
		...Array.from({ length: added }, (_, at) => `+const next${at} = ${at};`),
	].join("\n");
}

/**
 * A session for context, cost and files: persisted system messages with a changed skills section, a
 * model change, a pause over the cache TTL, a compaction, cache misses after each, and one file edited
 * five times (one edit failing) — rework.
 */
export function seedContextSession(workspace: { worktreePath: string }): void {
	const { refactor } = CONTEXT_SESSIONS;
	const start = INSIGHTS_TS + 7 * 3_600_000;
	const at = (seconds: number) => start + seconds * 1000;
	const OPENAI = { provider: "openai", model: "gpt-5" } as const;
	const sections = {
		preamble: "You are a careful coding agent working in this repository.",
		skills: "<skills>\n- parser-style: how parsers are written here\n</skills>",
	};
	const messages: FixtureMessage[] = [
		{ role: "system", sections, toolsAdded: TOOL_DECLARATIONS, timestamp: at(0) },
		{
			role: "user",
			text: "Refactor the parser into small functions and keep the docs in sync",
			timestamp: at(1),
		},
	];
	let n = 0;
	const step = (
		seconds: number,
		name: string,
		args: ToolArgs,
		usage: Usage,
		result: { text?: string; isError?: boolean; details?: unknown } = {},
		model: { provider: string; model: string } = PRICED,
	) => {
		n += 1;
		const id = `ctx-${n}`;
		messages.push(
			{
				role: "assistant",
				...model,
				content: [{ type: "toolCall", id, name, arguments: args }],
				usage,
				stopReason: "toolUse",
				timestamp: at(seconds),
				durationMs: 3_000,
			},
			{
				role: "toolResult",
				toolCallId: id,
				toolName: name,
				content: [{ type: "text", text: result.text ?? "ok" }],
				...(result.details !== undefined ? { details: result.details } : {}),
				isError: result.isError ?? false,
				timestamp: at(seconds + 4),
				durationMs: 400,
			},
		);
	};
	const parser = "src/parser.ts";
	const edit = (added: number, removed: number, line: number) => ({
		details: { diff: "", patch: editPatch(parser, added, removed), firstChangedLine: line },
	});
	step(10, "read", { path: parser }, cached({ input: 2_000, cacheWrite: 30_000 }, 0.2), {
		text: "export function parse(input: string) {\n".repeat(300),
	});
	step(
		20,
		"edit",
		{ path: parser, edits: [] },
		cached({ input: 400, cacheRead: 31_000, cacheWrite: 2_500 }, 0.03),
		edit(6, 2, 3),
	);
	step(
		30,
		"edit",
		{ path: parser, edits: [] },
		cached({ input: 400, cacheRead: 33_000, cacheWrite: 600 }, 0.02),
		{
			text: "Could not find the exact text in src/parser.ts",
			isError: true,
		},
	);
	step(
		40,
		"edit",
		{ path: parser, edits: [] },
		cached({ input: 400, cacheRead: 33_500, cacheWrite: 700 }, 0.02),
		edit(4, 1, 18),
	);
	step(
		50,
		"edit",
		{ path: parser, edits: [] },
		cached({ input: 400, cacheRead: 34_000, cacheWrite: 700 }, 0.02),
		edit(3, 3, 25),
	);
	step(
		60,
		"write",
		{ path: parser, content: "export function parse(input: string) {\n\treturn input;\n}\n" },
		cached({ input: 400, cacheRead: 34_500, cacheWrite: 900 }, 0.02),
	);
	step(
		70,
		"edit",
		{ path: parser, edits: [] },
		cached({ input: 400, cacheRead: 35_200, cacheWrite: 600 }, 0.02),
		edit(2, 0, 2),
	);
	step(
		80,
		"read",
		{ path: "README.md" },
		cached({ input: 400, cacheRead: 35_600, cacheWrite: 500 }, 0.02),
		{
			text: "# Fixture repo",
		},
	);
	messages.push({
		role: "assistant",
		...PRICED,
		text: "The parser is split into small functions.",
		usage: cached({ input: 300, cacheRead: 36_000, cacheWrite: 400 }, 0.02),
		stopReason: "stop",
		timestamp: at(90),
		durationMs: 2_000,
	});
	messages.push({
		role: "system",
		sections: {
			skills:
				"<skills>\n- parser-style: how parsers are written here\n- docs-sync: keep docs in step with code\n</skills>",
		},
		timestamp: at(120),
	});
	const docsPrompt = messages.length;
	messages.push({ role: "user", text: "Now update the parser docs", timestamp: at(121) });
	step(
		130,
		"edit",
		{ path: "docs/parser.md", edits: [] },
		cached({ input: 500, cacheRead: 5_000, cacheWrite: 32_000 }, 0.25),
		{
			details: { diff: "", patch: editPatch("docs/parser.md", 5, 1), firstChangedLine: 1 },
		},
	);
	messages.push({
		role: "modelChange",
		provider: OPENAI.provider,
		modelId: OPENAI.model,
		timestamp: at(140),
	});
	step(
		150,
		"bash",
		{ command: "bun test parser" },
		cached({ input: 1_000, cacheWrite: 38_000 }, 0.3),
		{ text: "12 pass" },
		OPENAI,
	);
	step(
		160,
		"read",
		{ path: "docs/parser.md" },
		cached({ input: 500, cacheRead: 38_500, cacheWrite: 400 }, 0.02),
		{ text: "# Parser" },
		OPENAI,
	);
	step(
		600,
		"bash",
		{ command: "bun run lint" },
		cached({ input: 500, cacheRead: 1_000, cacheWrite: 38_400 }, 0.3),
		{ text: "clean" },
		OPENAI,
	);
	messages.push({
		role: "compaction",
		summary: "We split the parser and updated its docs.",
		tokensBefore: 40_000,
		firstKept: docsPrompt,
		systemMessage: {
			role: "system",
			content: "",
			sections: {
				...sections,
				skills:
					"<skills>\n- parser-style: how parsers are written here\n- docs-sync: keep docs in step with code\n</skills>",
			},
			toolsAdded: TOOL_DECLARATIONS,
			timestamp: at(610),
		},
		timestamp: at(610),
	});
	step(
		620,
		"read",
		{ path: parser },
		cached({ input: 500, cacheWrite: 9_000 }, 0.08),
		{ text: "export {}" },
		OPENAI,
	);
	messages.push({
		role: "assistant",
		...OPENAI,
		text: "Docs and parser are in sync.",
		usage: cached({ input: 300, cacheRead: 9_200, cacheWrite: 300 }, 0.01),
		stopReason: "stop",
		timestamp: at(640),
		durationMs: 2_000,
	});
	seedWorkspaceSession(workspace.worktreePath, { id: refactor.id, name: refactor.title, messages });
}

export const STATS_SESSIONS = {
	first: { id: "e2e-stats-parser", title: "Tidy the parser" },
	second: { id: "e2e-stats-lint", title: "Make the linter happy" },
	bridge: { id: "e2e-stats-bridge", title: "Summarize the parser changes" },
	elsewhere: { id: "e2e-stats-elsewhere", title: "Notes outside the project" },
} as const;

/** Local mornings of three days in a row, so the sessions span three host-local days in any time zone. */
export const STATS_DAYS = ["2024-11-04", "2024-11-05", "2024-11-06"] as const;

function statsAt(day: number, seconds: number): number {
	return new Date(2024, 10, 4 + day, 10).getTime() + seconds * 1000;
}

const STATS_INSTRUCTION = "Run the linters and the tests before you tell me the task is done.";

function skillsSection(names: readonly string[]): string {
	return [
		"<skills>",
		"The following skills provide specialized instructions for specific tasks.",
		"<available_skills>",
		...names.flatMap((name) => [
			"  <skill>",
			`    <name>${name}</name>`,
			`    <description>How to ${name.replace(/-/g, " ")} in this repository.</description>`,
			`    <location>/opt/skills/${name}/SKILL.md</location>`,
			"  </skill>",
		]),
		"</available_skills>",
		"</skills>",
	].join("\n");
}

/**
 * Sessions for the statistics: three in the project over three days and one outside every project.
 * `bun run lint` fails in two sessions (3 of 6 runs) and `bun run lint --fix` worked after a failure;
 * the persisted skills list names two skills nobody loads; `src/parser.ts` changes ten times in one
 * session; the user repeats one instruction in all three project sessions; the last one runs on
 * claude-bridge, which records $0.
 */
export function seedStatsSessions(workspace: { worktreePath: string }): void {
	const cwd = workspace.worktreePath;
	let n = 0;
	const call = (
		at: number,
		name: string,
		args: ToolArgs,
		result: { text?: string; isError?: boolean; details?: unknown } = {},
		model: { provider: string; model: string } = PRICED,
		cost = 0.02,
	): FixtureMessage[] => {
		n += 1;
		const id = `stats-${n}`;
		return [
			{
				role: "assistant",
				...model,
				content: [{ type: "toolCall", id, name, arguments: args }],
				usage: spend({ input: 1_500, output: 200, cacheRead: 6_000, cacheWrite: 300 }, cost),
				stopReason: "toolUse",
				timestamp: at,
				durationMs: 1_500,
			},
			{
				role: "toolResult",
				toolCallId: id,
				toolName: name,
				content: [{ type: "text", text: result.text ?? "ok" }],
				...(result.details !== undefined ? { details: result.details } : {}),
				isError: result.isError ?? false,
				timestamp: at + 2_000,
				durationMs: 1_200,
			},
		];
	};
	const lintFailure = {
		text: "src/parser.ts:3:1 error  Unexpected any  no-explicit-any\nCommand exited with code 1",
		isError: true,
	};
	const edit = (at: number, line: number) =>
		call(
			at,
			"edit",
			{ path: "src/parser.ts", edits: [] },
			{
				details: { diff: "", patch: editPatch("src/parser.ts", 2, 1), firstChangedLine: line },
			},
		);

	const day0 = (seconds: number) => statsAt(0, seconds);
	seedWorkspaceSession(cwd, {
		id: STATS_SESSIONS.first.id,
		name: STATS_SESSIONS.first.title,
		messages: [
			{
				role: "system",
				sections: { skills: skillsSection(["review-pr", "release-notes", "deploy-docs"]) },
				timestamp: day0(0),
			},
			{ role: "user", text: `Tidy the parser. ${STATS_INSTRUCTION}`, timestamp: day0(1) },
			...call(day0(10), "read", { path: "/opt/skills/review-pr/SKILL.md" }, { text: "# Review" }),
			...call(day0(20), "read", { path: "README.md" }, { text: "# Fixture repo" }),
			...call(day0(30), "bash", { command: "bun run lint" }, lintFailure),
			...call(day0(40), "bash", { command: "bun run lint --fix" }, { text: "Fixed 1 file" }),
			...Array.from({ length: 10 }, (_, at) => edit(day0(60 + at * 10), 3 + at)).flat(),
			{
				role: "assistant",
				...PRICED,
				text: "The parser is tidy.",
				usage: spend({ input: 800, output: 120, cacheRead: 7_000 }, 0.03),
				stopReason: "stop",
				timestamp: day0(200),
				durationMs: 1_000,
			},
		],
	});

	const day1 = (seconds: number) => statsAt(1, seconds);
	seedWorkspaceSession(cwd, {
		id: STATS_SESSIONS.second.id,
		name: STATS_SESSIONS.second.title,
		messages: [
			{ role: "user", text: `${STATS_INSTRUCTION} Start with the linter.`, timestamp: day1(0) },
			...call(day1(10), "bash", { command: "bun run lint" }, lintFailure),
			...call(day1(20), "bash", { command: "bun run lint" }, lintFailure),
			...edit(day1(30), 3),
			...edit(day1(40), 9),
			...call(day1(50), "bash", { command: "bun run lint" }, { text: "Checked 12 files" }),
			...call(day1(60), "bash", { command: "bun run lint" }, { text: "Checked 12 files" }),
			...call(day1(70), "read", { path: "README.md" }, { text: "# Fixture repo" }),
			{
				role: "assistant",
				...PRICED,
				text: "The linter is happy.",
				usage: spend({ input: 600, output: 90, cacheRead: 7_200 }, 0.02),
				stopReason: "stop",
				timestamp: day1(90),
				durationMs: 900,
			},
		],
	});

	const day2 = (seconds: number) => statsAt(2, seconds);
	const BRIDGE = { provider: "claude-bridge", model: "claude-sonnet-4-5" } as const;
	seedWorkspaceSession(cwd, {
		id: STATS_SESSIONS.bridge.id,
		name: STATS_SESSIONS.bridge.title,
		messages: [
			{
				role: "user",
				text: `Summarize the parser changes. ${STATS_INSTRUCTION}`,
				timestamp: day2(0),
			},
			...call(day2(10), "read", { path: "README.md" }, { text: "# Fixture repo" }, BRIDGE, 0),
			...call(day2(20), "bash", { command: "bun test" }, { text: "12 pass" }, BRIDGE, 0),
			{
				role: "assistant",
				...BRIDGE,
				text: "Three small refactors of the parser.",
				usage: spend({ input: 9_000, output: 400, cacheRead: 12_000 }, 0),
				stopReason: "stop",
				timestamp: day2(40),
				durationMs: 1_100,
			},
		],
	});

	writeFixtureSession(defaultSessionDirFor(E2E_PI_AGENT_DIR, E2E_EXTERNAL_CWD), {
		id: STATS_SESSIONS.elsewhere.id,
		cwd: E2E_EXTERNAL_CWD,
		name: STATS_SESSIONS.elsewhere.title,
		messages: [
			{ role: "user", text: "Collect my notes", timestamp: day2(3_600) },
			...call(day2(3_610), "read", { path: "notes.md" }, { text: "- notes" }),
			{
				role: "assistant",
				...PRICED,
				text: "Collected.",
				usage: spend({ input: 300, output: 50 }, 0.01),
				stopReason: "stop",
				timestamp: day2(3_640),
				durationMs: 700,
			},
		],
	});
}

export const SEQUENCE_SESSIONS = {
	sonnet: [
		{ id: "e2e-seq-date", title: "Fix the date parser" },
		{ id: "e2e-seq-time", title: "Fix the time parser" },
		{ id: "e2e-seq-url", title: "Fix the URL parser" },
		{ id: "e2e-seq-csv", title: "Fix the CSV parser" },
	],
	gpt: [
		{ id: "e2e-seq-date-gpt", title: "Fix the date parser on GPT" },
		{ id: "e2e-seq-time-gpt", title: "Fix the time parser on GPT" },
		{ id: "e2e-seq-url-gpt", title: "Fix the URL parser on GPT" },
	],
} as const;

export const SEQUENCE_MODELS = {
	sonnet: "anthropic/claude-sonnet-4-5",
	gpt: "openai/gpt-5",
} as const;

/**
 * Seven comparable sessions on two models, interleaved over a week. The Sonnet ones read twice (a
 * loop), fail `bun test date`, edit and pass it (a recovery); the GPT ones search instead of reading
 * the test, never fail and end with a README read. Every session makes six calls, so calls per session
 * are indistinguishable while the failure share is not. The first of each also has a second turn with a
 * near-identical prompt, for the two-session diff.
 */
export function seedSequenceSessions(workspace: { worktreePath: string }): void {
	const cwd = workspace.worktreePath;
	const GPT = { provider: "openai", model: "gpt-5" } as const;
	type Call = readonly [name: string, args: ToolArgs, failed?: boolean];
	const sonnetCalls: readonly Call[] = [
		["read", { path: "src/date.ts" }],
		["read", { path: "src/date.test.ts" }],
		["bash", { command: "bun test date" }, true],
		["edit", { path: "src/date.ts", edits: [] }],
		["bash", { command: "bun test date" }],
		["bash", { command: "git status" }],
	];
	const gptCalls: readonly Call[] = [
		["read", { path: "src/date.ts" }],
		["grep", { pattern: "parseDate" }],
		["bash", { command: "bun test date" }],
		["edit", { path: "src/date.ts", edits: [] }],
		["bash", { command: "bun test date --bail" }],
		["read", { path: "README.md" }],
	];
	const seed = (
		session: { id: string; title: string },
		day: number,
		model: { provider: string; model: string },
		calls: readonly Call[],
		followUp: string | null,
	) => {
		const at = (seconds: number) => new Date(2024, 10, 18 + day, 10).getTime() + seconds * 1000;
		const messages: FixtureMessage[] = [{ role: "user", text: session.title, timestamp: at(0) }];
		let clock = 5;
		const call = (name: string, args: ToolArgs, failed: boolean) => {
			const id = `${session.id}-${messages.length}`;
			messages.push(
				{
					role: "assistant",
					...model,
					content: [{ type: "toolCall", id, name, arguments: args }],
					usage: spend({ input: 1_200, output: 150, cacheRead: 5_000, cacheWrite: 200 }, 0.02),
					stopReason: "toolUse",
					timestamp: at(clock),
					durationMs: 1_500,
				},
				{
					role: "toolResult",
					toolCallId: id,
					toolName: name,
					content: [
						{
							type: "text",
							text: failed
								? "1 test failed: parseDate('2024-02-30')\nCommand exited with code 1"
								: "ok",
						},
					],
					isError: failed,
					timestamp: at(clock + 2),
					durationMs: 1_000,
				},
			);
			clock += 10;
		};
		for (const [name, args, failed] of calls) call(name, args, failed === true);
		messages.push({
			role: "assistant",
			...model,
			text: "The parser is fixed.",
			usage: spend({ input: 600, output: 80, cacheRead: 5_500 }, 0.01),
			stopReason: "stop",
			timestamp: at(clock),
			durationMs: 900,
		});
		if (followUp) {
			clock += 600;
			messages.push({ role: "user", text: followUp, timestamp: at(clock) });
			clock += 5;
			call("edit", { path: "CHANGELOG.md", edits: [] }, false);
			messages.push({
				role: "assistant",
				...model,
				text: "The changelog is updated.",
				usage: spend({ input: 300, output: 60, cacheRead: 5_800 }, 0.01),
				stopReason: "stop",
				timestamp: at(clock),
				durationMs: 700,
			});
		}
		seedWorkspaceSession(cwd, { id: session.id, name: session.title, messages });
	};
	for (const [at, session] of SEQUENCE_SESSIONS.sonnet.entries())
		seed(
			session,
			at * 2,
			PRICED,
			sonnetCalls,
			at === 0 ? "Now update the changelog for the date parser fix" : null,
		);
	for (const [at, session] of SEQUENCE_SESSIONS.gpt.entries())
		seed(
			session,
			at * 2 + 1,
			GPT,
			gptCalls,
			at === 0 ? "Update the changelog for the date parser fix now" : null,
		);
}

const EXPORT_TS = 1_731_500_000_000;

/** A secret a session's prompt and command carry; no export may contain it. */
export const PLANTED_SECRET = "sk-ant-api03-E2EPLANTEDSECRETVALUE0123456789";

export const EXPORT_SESSIONS = {
	deploy: { id: "e2e-export-deploy", title: "Deploy the staging site" },
	docs: { id: "e2e-export-docs", title: "Polish the docs index" },
} as const;

export function seedExportSessions(workspace: { worktreePath: string }): void {
	const cwd = workspace.worktreePath;
	const { deploy, docs } = EXPORT_SESSIONS;
	seedWorkspaceSession(cwd, {
		id: deploy.id,
		name: deploy.title,
		messages: [
			{
				role: "user",
				text: `deploy staging with the key ${PLANTED_SECRET} and mail ops@example.com when done`,
				timestamp: EXPORT_TS,
			},
			{
				role: "assistant",
				...PRICED,
				content: [
					{
						type: "toolCall",
						id: "deploy-1",
						name: "bash",
						arguments: { command: `ANTHROPIC_API_KEY=${PLANTED_SECRET} ./deploy.sh staging` },
					},
					{
						type: "toolCall",
						id: "deploy-2",
						name: "read",
						arguments: { path: `${cwd}/README.md` },
					},
				],
				usage: spend({ input: 4_000, output: 300, cacheRead: 6_000 }, 0.08),
				stopReason: "toolUse",
				timestamp: EXPORT_TS + 10_000,
				durationMs: 2_000,
			},
			{
				role: "toolResult",
				toolCallId: "deploy-1",
				toolName: "bash",
				content: [{ type: "text", text: "Deployed to https://staging.example.com" }],
				isError: false,
				timestamp: EXPORT_TS + 25_000,
				durationMs: 12_000,
			},
			{
				role: "toolResult",
				toolCallId: "deploy-2",
				toolName: "read",
				content: [{ type: "text", text: "# Sample project" }],
				isError: false,
				timestamp: EXPORT_TS + 14_000,
				durationMs: 1_000,
			},
			{
				role: "assistant",
				...PRICED,
				text: "Staging is deployed.",
				usage: spend({ input: 1_000, output: 100, cacheRead: 9_000 }, 0.02),
				timestamp: EXPORT_TS + 30_000,
			},
		],
	});
	seedWorkspaceSession(cwd, {
		id: docs.id,
		name: docs.title,
		messages: [
			{ role: "user", text: "polish the docs index", timestamp: EXPORT_TS - 3_600_000 },
			{
				role: "assistant",
				...PRICED,
				text: "Reworded the intro and sorted the links.",
				usage: spend({ input: 2_000, output: 400 }, 0.03),
				timestamp: EXPORT_TS - 3_600_000 + 20_000,
			},
		],
	});
}
