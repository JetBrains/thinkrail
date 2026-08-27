import { beforeEach, expect, test } from "bun:test";
import {
	DEFAULT_CONFIG,
	type ExtUiRequest,
	type PiEvent,
	type Project,
	type SessionEventPayload,
	type SessionSummary,
	type SpecGraphNode,
	type WireModel,
	type Workspace,
	type WorkspaceFsChangedPayload,
	type WorkspaceLayoutDocument,
	type WorkspaceSkillChange,
} from "@thinkrail/contracts";
import type { ChatTurn, FailureRecovery } from "../chat/types";
import { userText } from "../lib";
import {
	captureCenterNavigation,
	chatTabId,
	type FileTab,
	isCenterNavigationCurrent,
	layoutOpenOptionsForNavigation,
	type SessionRuntime,
	shouldAdvanceAcceptedNavigation,
	toast,
	useAppStore,
} from "./appStore";
import {
	selectCompactionTurnIds,
	selectCurrentRouteChatTarget,
	selectDiffScope,
	selectLastOpenChatSession,
	selectSkillsStale,
	selectWorkspaceNavTick,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
} from "./selectors";

const agentStart = { type: "agent_start" } as unknown as PiEvent;
const agentEnd = { type: "agent_end", willRetry: false, messages: [] } as unknown as PiEvent;
const agentSettled = (terminal: Extract<PiEvent, { type: "agent_settled" }>["terminal"] = null) =>
	({ type: "agent_settled", terminal }) as PiEvent;
const recoveredOverflow: PiEvent = {
	type: "compaction_end",
	reason: "overflow",
	result: {},
	aborted: false,
	willRetry: true,
};
const toolStart = (toolCallId: string) =>
	({ type: "tool_execution_start", toolCallId, toolName: "bash" }) as unknown as PiEvent;
const toolUpdate = (toolCallId: string, partialResult: unknown) =>
	({ type: "tool_execution_update", toolCallId, partialResult }) as unknown as PiEvent;
const toolEnd = (toolCallId: string, result: unknown, isError = false) =>
	({ type: "tool_execution_end", toolCallId, result, isError }) as unknown as PiEvent;
const retryStart = (attempt: number, maxAttempts: number, delayMs: number) =>
	({
		type: "auto_retry_start",
		attempt,
		maxAttempts,
		delayMs,
		errorMessage: "rate limit",
	}) as unknown as PiEvent;
const retryEnd = { type: "auto_retry_end", success: true, attempt: 1 } as unknown as PiEvent;
const summarizationScheduled = (
	attempt: number,
	maxAttempts: number,
	delayMs: number,
): PiEvent => ({
	type: "summarization_retry_scheduled",
	attempt,
	maxAttempts,
	delayMs,
	errorMessage: "stream dropped",
});
const summarizationFinished: PiEvent = { type: "summarization_retry_finished" };
const agentEndError = (errorMessage: string) =>
	({
		type: "agent_end",
		willRetry: false,
		messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage }],
	}) as unknown as PiEvent;
const assistantStart = {
	type: "message_start",
	message: { role: "assistant" },
} as unknown as PiEvent;
const userStart = (text: string) =>
	({
		type: "message_start",
		message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
	}) as unknown as PiEvent;
const assistantText = (text: string) =>
	({
		type: "message_update",
		assistantMessageEvent: {
			type: "text",
			partial: { role: "assistant", content: [{ type: "text", text }] },
		},
	}) as unknown as PiEvent;
const emptyBottomRegion = (): WorkspaceLayoutDocument["bottom"] => ({
	visible: false,
	height: 0.3,
	alignment: "center",
	groups: [],
});

beforeEach(() => {
	useAppStore.setState({
		status: "connecting",
		connectionGeneration: 0,
		welcomeGeneration: 0,
		protocolVersion: null,
		routeChatTarget: null,
		routeChatTargetGeneration: 0,
		sessions: {},
		extUiOrphans: [],
		workbenchFrame: null,
		workspaceViewsByWorkspace: {},
		layoutStateReady: false,
		legacyLayoutImportAttempted: {},
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutRemoteEpochByWorkspace: {},
		layoutIntents: [],
		tabsByWorkspace: {},
		terminalsByWorkspace: {},
		activeTerminalByWorkspace: {},
		activeTabByWorkspace: {},
		previewTabByWorkspace: {},
		navTickByWorkspace: {},
		closedChatsByWorkspace: {},
		deletedSessionsByWorkspace: {},
		fsChangesByWorkspace: {},
		skillChangeTickByWorkspace: {},
		skillsSyncedTickBySession: {},
		projects: [],
		recentProjects: [],
		workspaces: {},
		removedWorkspaceIds: {},
		expandedProjectIds: {},
		selectedProjectId: null,
		activeWorkspaceId: null,
		workspaceSelectionHistory: [],
		activeLogin: null,
		settingsOpen: false,
		settingsSection: "providers",
		toasts: [],
	});
});

function rt(sessionId: string): SessionRuntime {
	const runtime = useAppStore.getState().sessions[sessionId];
	if (!runtime) throw new Error(`no runtime for ${sessionId}`);
	return runtime;
}

function failureRecovery(sessionId: string): FailureRecovery | undefined {
	const error = rt(sessionId).turns.find((turn) => turn.kind === "error");
	return error?.kind === "error" ? error.recovery : undefined;
}

test("each connected status advances the reconnect generation atomically", () => {
	const store = useAppStore.getState();
	store.setStatus("connected");
	expect(useAppStore.getState()).toMatchObject({ status: "connected", connectionGeneration: 1 });
	store.setStatus("disconnected");
	expect(useAppStore.getState()).toMatchObject({ status: "disconnected", connectionGeneration: 1 });
	store.setStatus("connecting");
	store.setStatus("connected");
	expect(useAppStore.getState()).toMatchObject({ status: "connected", connectionGeneration: 2 });
});

test("selectLastOpenChatSession: active chat tab first, then the most recent chat tab, else null", () => {
	const store = useAppStore.getState();
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBeNull();
	store.openChatSession("ws1", "s1", null, "medium");
	store.openChatSession("ws1", "s2", null, "medium");
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBe("s2");
	useAppStore.getState().openTab(fileTab("ws1", "a.ts"), "keep");
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBe("s2");
});

test("pi events route to the right session runtime; chats stay independent", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "high");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(toolStart("t1"), "a");
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").toolResults.t1?.status).toBe("running");
	expect(rt("b").isStreaming).toBe(false);
	expect(Object.keys(rt("b").toolResults)).toHaveLength(0);

	store.handlePiEvent(agentStart, "b");
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("b").isStreaming).toBe(true);

	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(false);
	store.handlePiEvent(agentSettled(), "a");
	expect(rt("a").isStreaming).toBe(false);
	expect(rt("a").turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
	expect(rt("b").isStreaming).toBe(true);
	expect(rt("b").turns).toHaveLength(0);
});

test("an ordered Pi-event batch commits once while preserving every session revision", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "high");
	const partial = { content: [{ type: "text", text: "partial" }] };
	const payloads: SessionEventPayload[] = [
		{ sessionId: "a", event: agentStart },
		{ sessionId: "a", event: toolStart("t1") },
		{ sessionId: "b", event: agentStart },
		{ sessionId: "a", event: toolUpdate("t1", partial) },
		{ sessionId: "a", event: agentEnd },
		{ sessionId: "missing", event: agentStart },
	];
	let commits = 0;
	const unsubscribe = useAppStore.subscribe(() => {
		commits += 1;
	});

	store.handlePiEvents(payloads);
	unsubscribe();

	expect(commits).toBe(1);
	expect(rt("a").eventRevision).toBe(4);
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").toolResults.t1).toEqual({ status: "running", raw: partial });
	expect(rt("b").eventRevision).toBe(1);
	expect(rt("b").isStreaming).toBe(true);
});

test("a host-fired USER message folds into the transcript; the composer's optimistic twin doesn't duplicate", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(userStart("<review pkg>"), "a");
	expect(rt("a").turns).toHaveLength(1);
	expect(rt("a").turns[0]?.kind).toBe("user");

	store.appendUserMessage("a", "fix the tests");
	store.handlePiEvent(userStart("fix the tests"), "a");
	expect(rt("a").turns.filter((t) => t.kind === "user")).toHaveLength(2);

	store.handlePiEvent(userStart("[thinkrail:todo-nudge] plan changed"), "a");
	expect(rt("a").turns.filter((t) => t.kind === "user")).toHaveLength(2);
});

test("queue_update folds pi's queue into the runtime; the canonical echo lands the turn at its true position", () => {
	const queueUpdate = (steering: string[], followUp: string[], hasImages = false) =>
		({
			type: "queue_update",
			steering,
			followUp,
			...(hasImages ? { hasImages: true } : {}),
		}) as unknown as PiEvent;
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("first reply"), "a");

	store.handlePiEvent(queueUpdate(["course-correct"], ["queued question"], true), "a");
	expect(rt("a").queue).toEqual({
		steering: ["course-correct"],
		followUp: ["queued question"],
		hasImages: true,
	});
	expect(rt("a").turns.filter((t) => t.kind === "user")).toHaveLength(0);

	store.handlePiEvent(queueUpdate([], ["queued question"]), "a");
	store.handlePiEvent(userStart("course-correct"), "a");
	store.handlePiEvent(queueUpdate([], []), "a");
	store.handlePiEvent(userStart("queued question"), "a");

	const turns = rt("a").turns;
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "user", "user"]);
	expect(rt("a").queue).toEqual({ steering: [], followUp: [] });
});

test("hydrateSession seeds the queue from the summary snapshot", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const summary: SessionSummary = {
		sessionId: "q1",
		workspaceId: "ws1",
		title: "Chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: true,
		messageCount: 1,
		updatedAt: 0,
		live: true,
		queue: { steering: [], followUp: ["waiting in line"] },
	};
	store.hydrateSession(summary, { turns: [], toolResults: {}, askAnswers: {} });
	expect(rt("q1").queue).toEqual({ steering: [], followUp: ["waiting in line"] });

	const { queue, ...bare } = summary;
	void queue;
	store.hydrateSession(
		{ ...bare, sessionId: "q2" },
		{ turns: [], toolResults: {}, askAnswers: {} },
	);
	expect(rt("q2").queue).toEqual({ steering: [], followUp: [] });
});

test("Pi's expanded skill echo replaces its matching optimistic slash command in place", () => {
	const expanded =
		'<skill name="review" location="/repo/.pi/skills/review/SKILL.md">\nReferences are relative to /repo/.pi/skills/review.\n\n# Review\n\nInspect the diff.\n</skill>\n\nFocus on src/app.ts.';
	const store = useAppStore.getState();
	store.openChatSession("ws1", "skill", null, "medium");
	store.appendUserMessage("skill", "/skill:review Focus on src/app.ts.");
	const optimistic = rt("skill").turns[0];
	if (optimistic?.kind !== "user") throw new Error("optimistic turn missing");

	store.handlePiEvent(userStart(expanded), "skill");
	const turns = rt("skill").turns;
	expect(turns).toHaveLength(1);
	const canonical = turns[0];
	expect(canonical?.id).toBe(optimistic.id);
	expect(canonical?.kind === "user" && userText(canonical.message.content)).toBe(expanded);

	store.openChatSession("ws1", "mismatch", null, "medium");
	store.appendUserMessage("mismatch", "/skill:other Focus on src/app.ts.");
	store.handlePiEvent(userStart(expanded), "mismatch");
	expect(rt("mismatch").turns.filter((turn) => turn.kind === "user")).toHaveLength(2);
});

test("an assistant turn is built (and replaced, not duplicated) from message_update partials", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("po"), "a");
	store.handlePiEvent(assistantText("pong"), "a");

	const assistants = rt("a").turns.filter((t) => t.kind === "assistant");
	expect(assistants).toHaveLength(1);
	const turn = assistants[0];
	expect(turn?.kind === "assistant" && turn.streaming).toBe(true);
	expect(turn?.kind === "assistant" && turn.message.content[0]?.type === "text").toBe(true);

	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").isStreaming).toBe(true);
	store.handlePiEvent(agentSettled(), "a");
	const after = rt("a");
	expect(after.isStreaming).toBe(false);
	expect(after.currentAssistantId).toBeNull();
	expect(after.turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
});

test("a multi-message turn leaves no assistant turn flagged streaming (no stray live indicator)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("first"), "a");
	store.handlePiEvent(assistantStart, "a");
	expect(rt("a").turns.filter((t) => t.kind === "assistant" && t.streaming)).toHaveLength(0);
	store.handlePiEvent(assistantText("second"), "a");
	const streamingMid = rt("a").turns.filter((t) => t.kind === "assistant" && t.streaming);
	expect(streamingMid).toHaveLength(1);

	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").turns.some((t) => t.kind === "assistant" && t.streaming)).toBe(true);
	store.handlePiEvent(agentSettled(), "a");
	const after = rt("a");
	expect(after.turns.filter((t) => t.kind === "assistant")).toHaveLength(2);
	expect(after.turns.some((t) => t.kind === "assistant" && t.streaming)).toBe(false);
	expect(after.isStreaming).toBe(false);
});

test("message_end finalizes the turn the moment its message completes (not at agent_end)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("asking…"), "a");
	expect(rt("a").turns.some((t) => t.kind === "assistant" && t.streaming)).toBe(true);

	const finalMessage = {
		role: "assistant",
		content: [{ type: "toolCall", id: "ask1", name: "ask_user_question", arguments: {} }],
		stopReason: "toolUse",
	};
	store.handlePiEvent({ type: "message_end", message: finalMessage } as unknown as PiEvent, "a");

	const after = rt("a");
	expect(after.isStreaming).toBe(true);
	expect(after.currentAssistantId).toBeNull();
	const turn = after.turns.find((t) => t.kind === "assistant");
	expect(turn?.kind === "assistant" && turn.streaming).toBe(false);
	expect(turn?.kind === "assistant" && turn.message.stopReason).toBe("toolUse");

	const before = rt("a");
	store.handlePiEvent(
		{ type: "message_end", message: { role: "toolResult" } } as unknown as PiEvent,
		"a",
	);
	const ignored = rt("a");
	expect(ignored.turns).toBe(before.turns);
	expect(ignored.eventRevision).toBe(before.eventRevision + 1);
});

test("an ask-user-answers custom message_end indexes into askAnswers (never the turn list)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	const result = {
		answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
		cancelled: false,
	};
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "custom",
				customType: "ask-user-answers",
				content: "User has answered your questions: …",
				display: true,
				details: { toolCallId: "ask1", result },
			},
		} as unknown as PiEvent,
		"a",
	);
	expect(rt("a").askAnswers.ask1).toEqual(result as never);
	expect(rt("a").turns.filter((t) => t.kind === "assistant" || t.kind === "user")).toHaveLength(0);

	const before = rt("a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: { role: "custom", customType: "other", content: "x", display: false },
		} as unknown as PiEvent,
		"a",
	);
	const ignored = rt("a");
	expect(ignored.turns).toBe(before.turns);
	expect(ignored.askAnswers).toBe(before.askAnswers);
	expect(ignored.eventRevision).toBe(before.eventRevision + 1);
});

test("a subagent-completion custom message_end appends a subagentCompletion turn", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	const details = {
		childSessionId: "child-1",
		roleName: "scout",
		task: "map the repo",
		status: "completed",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.01,
			turns: 3,
			contextTokens: 15,
		},
		durationMs: 4200,
	};
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "custom",
				customType: "subagent-completion",
				content: 'Subagent "scout" (child-1) completed:\n\nthe report',
				display: true,
				details,
			},
		} as unknown as PiEvent,
		"a",
	);
	const turn = rt("a").turns.at(-1);
	expect(turn?.kind).toBe("subagentCompletion");
	expect(turn?.kind === "subagentCompletion" && turn.details.childSessionId).toBe("child-1");
	expect(turn?.kind === "subagentCompletion" && turn.text).toContain("the report");

	const before = rt("a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "custom",
				customType: "subagent-completion",
				content: "x",
				display: true,
				details: { nope: true },
			},
		} as unknown as PiEvent,
		"a",
	);
	const ignored = rt("a");
	expect(ignored.turns).toBe(before.turns);
	expect(ignored.eventRevision).toBe(before.eventRevision + 1);
});

test("the tool lifecycle folds into toolResults (the status + raw the renderers read)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(toolStart("t1"), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "running", raw: undefined });

	const partial = { content: [{ type: "text", text: "partial" }] };
	store.handlePiEvent(toolUpdate("t1", partial), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "running", raw: partial });

	const final = { content: [{ type: "text", text: "done" }] };
	store.handlePiEvent(toolEnd("t1", final), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "done", raw: final });
});

test("a failed tool ends in the error status (the red-path the renderers branch on)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(toolStart("t1"), "a");
	const errResult = { content: [{ type: "text", text: "boom" }] };
	store.handlePiEvent(toolEnd("t1", errResult, true), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "error", raw: errResult });
});

test("auto-retry adds a countdown turn, and resolving it clears the indicator", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(retryStart(2, 3, 5_000), "a");
	const retry = rt("a").turns.find((t) => t.kind === "retry");
	expect(retry?.kind === "retry" && retry.source).toBe("turn");
	expect(retry?.kind === "retry" && retry.attempt).toBe(2);
	expect(retry?.kind === "retry" && retry.maxAttempts).toBe(3);
	expect(retry?.kind === "retry" && retry.delayMs).toBe(5_000);

	store.handlePiEvent(retryEnd, "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
});

test("summarization retries show their own countdown; re-scheduling replaces, finished clears", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(summarizationScheduled(1, 3, 2_000), "a");
	const first = rt("a").turns.find((t) => t.kind === "retry");
	expect(first?.kind === "retry" && first.source).toBe("summarization");
	expect(first?.kind === "retry" && first.attempt).toBe(1);

	store.handlePiEvent(summarizationScheduled(2, 3, 4_000), "a");
	const retries = rt("a").turns.filter((t) => t.kind === "retry");
	expect(retries.length).toBe(1);
	expect(retries[0]?.kind === "retry" && retries[0].attempt).toBe(2);

	store.handlePiEvent(summarizationFinished, "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
});

test("overlapping turn + summarization retries never clear each other", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(retryStart(1, 3, 1_000), "a");
	store.handlePiEvent(summarizationScheduled(1, 3, 2_000), "a");
	expect(rt("a").turns.filter((t) => t.kind === "retry").length).toBe(2);

	store.handlePiEvent(retryEnd, "a");
	const left = rt("a").turns.filter((t) => t.kind === "retry");
	expect(left.length).toBe(1);
	expect(left[0]?.kind === "retry" && left[0].source).toBe("summarization");

	store.handlePiEvent(summarizationFinished, "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
});

test("a lingering retry countdown is swept up only when the run settles", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(retryStart(1, 3, 1_000), "a");
	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(true);
	store.handlePiEvent(agentSettled(), "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
	expect(rt("a").turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
});

test("auto-retry drops the failed attempt's turn — the retried message must not render twice", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("The answer is"), "a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "The answer is" }],
				stopReason: "error",
				errorMessage: "fetch failed",
			},
		} as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(
		{ type: "agent_end", willRetry: true, messages: [] } as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(retryStart(1, 3, 2_000), "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(true);

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("The answer is 4"), "a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "The answer is 4" }],
				stopReason: "stop",
			},
		} as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(agentSettled(), "a");

	const after = rt("a");
	const assistants = after.turns.filter((t) => t.kind === "assistant");
	expect(assistants).toHaveLength(1);
	expect(
		assistants[0]?.kind === "assistant" &&
			assistants[0].message.content.some((c) => c.type === "text" && c.text === "The answer is 4"),
	).toBe(true);
	expect(after.turns.some((t) => t.kind === "retry")).toBe(false);
	expect(after.turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
});

test("auto-retry with no assistant message yet (error before message_start) drops nothing", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.appendUserMessage("a", "hi");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(
		{ type: "agent_end", willRetry: true, messages: [] } as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(retryStart(1, 3, 2_000), "a");
	expect(rt("a").turns.filter((t) => t.kind === "user")).toHaveLength(1);
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(true);
});

test("a turn that ends in a provider error surfaces the error (not a false ✓ Done)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEndError("model 'gpt-5.5' not found"), "a");
	expect(rt("a").isStreaming).toBe(true);
	store.handlePiEvent(
		agentSettled({ stopReason: "error", errorMessage: "model 'gpt-5.5' not found" }),
		"a",
	);

	const after = rt("a");
	expect(after.isStreaming).toBe(false);
	const err = after.turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("gpt-5.5");
	expect(failureRecovery("a")).toBe("try-again");
	expect(after.turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(false);
});

test("a terminal length stop is a visible failure, never a false ✓ Done", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(agentSettled({ stopReason: "length" }), "a");

	const after = rt("a");
	const error = after.turns.find((turn) => turn.kind === "error");
	expect(error?.kind === "error" && error.text.toLowerCase()).toContain("truncated");
	expect(failureRecovery("a")).toBe("try-again");
	expect(after.turns.some((turn) => turn.kind === "system" && turn.text === "✓ Done")).toBe(false);
	expect(after.isStreaming).toBe(false);
});

test("a local follow-on consumes only its session's failure recovery", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	for (const sessionId of ["a", "b"]) {
		store.handlePiEvent(
			agentSettled({ stopReason: "error", errorMessage: "fetch failed" }),
			sessionId,
		);
	}

	store.appendUserMessage("a", "Try again.");

	expect(failureRecovery("a")).toBeUndefined();
	expect(failureRecovery("b")).toBe("try-again");
});

test("another client's agent start consumes only its session's failure recovery", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	for (const sessionId of ["a", "b"]) {
		store.handlePiEvent(
			agentSettled({ stopReason: "error", errorMessage: "fetch failed" }),
			sessionId,
		);
	}

	store.handlePiEvent(agentStart, "b");

	expect(failureRecovery("a")).toBe("try-again");
	expect(failureRecovery("b")).toBeUndefined();
});

test("a successful overflow compaction removes the superseded assistant attempt", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("incomplete"), "a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "incomplete" }],
				stopReason: "length",
			},
		} as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").turns.filter((turn) => turn.kind === "assistant")).toHaveLength(1);

	store.handlePiEvent(recoveredOverflow, "a");
	expect(rt("a").turns.filter((turn) => turn.kind === "assistant")).toHaveLength(0);
	expect(rt("a").isStreaming).toBe(true);
});

test("overflow recovery never removes an older failure when this attempt was not observed", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("old failed answer"), "a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "old failed answer" }],
				stopReason: "error",
				errorMessage: "old failure",
			},
		} as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(agentEndError("old failure"), "a");
	store.handlePiEvent(agentSettled({ stopReason: "error", errorMessage: "old failure" }), "a");
	expect(rt("a").turns.filter((turn) => turn.kind === "assistant")).toHaveLength(1);

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(recoveredOverflow, "a");

	expect(rt("a").turns.filter((turn) => turn.kind === "assistant")).toHaveLength(1);
});

const compactionStart = (reason: "manual" | "threshold" | "overflow" = "threshold"): PiEvent => ({
	type: "compaction_start",
	reason,
});
const compactionEnd = (over: Partial<Extract<PiEvent, { type: "compaction_end" }>> = {}): PiEvent =>
	({
		type: "compaction_end",
		reason: "threshold",
		result: { tokensBefore: 268_909, estimatedTokensAfter: 12_000 },
		aborted: false,
		willRetry: false,
		...over,
	}) as PiEvent;
const compactionTurns = (sessionId: string) =>
	rt(sessionId).turns.filter(
		(turn): turn is Extract<ChatTurn, { kind: "compaction" }> => turn.kind === "compaction",
	);

test("compaction lifecycle: a running notice settles in place (same id) with the token figures", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(compactionStart(), "a");
	const running = compactionTurns("a");
	expect(running).toMatchObject([{ status: "running" }]);
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").turns.filter((turn) => turn.kind === "system")).toHaveLength(0);

	store.handlePiEvent(compactionEnd(), "a");
	expect(compactionTurns("a")).toMatchObject([
		{ id: running[0]?.id, status: "done", tokensBefore: 268_909, tokensAfter: 12_000 },
	]);

	store.handlePiEvent(agentSettled(), "a");
	const turns = rt("a").turns;
	expect(turns.at(-1)).toMatchObject({ kind: "system", text: "✓ Done" });
	expect(turns.at(-2)).toMatchObject({ kind: "compaction", status: "done" });
});

test("the incident sequence: truncated response → compacting → compacted-resuming, never a misleading Done", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText(""), "a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "length" },
		} as unknown as PiEvent,
		"a",
	);
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(compactionStart("overflow"), "a");
	expect(compactionTurns("a")).toMatchObject([{ status: "running" }]);

	store.handlePiEvent(
		compactionEnd({ reason: "overflow", willRetry: true, result: { tokensBefore: 268_909 } }),
		"a",
	);
	expect(compactionTurns("a")).toMatchObject([
		{ status: "done", resuming: true, tokensBefore: 268_909 },
	]);
	expect(rt("a").turns.filter((turn) => turn.kind === "assistant")).toHaveLength(0);
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").turns.filter((turn) => turn.kind === "system")).toHaveLength(0);

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("finished the rebase"), "a");
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(agentSettled(), "a");
	expect(rt("a").turns.at(-1)).toMatchObject({ kind: "system", text: "✓ Done" });
	expect(rt("a").isStreaming).toBe(false);
	expect(compactionTurns("a")[0]?.resuming).toBeUndefined();
});

test("a failed compaction settles into a visible, actionable notice — and a cancelled one into a muted record", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(compactionStart("manual"), "a");
	store.handlePiEvent(
		compactionEnd({ reason: "manual", result: undefined, errorMessage: "Compaction failed: boom" }),
		"a",
	);
	expect(compactionTurns("a")).toMatchObject([
		{ status: "failed", detail: "Compaction failed: boom" },
	]);

	store.handlePiEvent(compactionStart("manual"), "a");
	store.handlePiEvent(compactionEnd({ reason: "manual", result: undefined, aborted: true }), "a");
	expect(compactionTurns("a")).toMatchObject([{ status: "failed" }, { status: "cancelled" }]);
});

test("manual compaction rejection appends one failed row only when no lifecycle was observed", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	const beforeEarlyFailure = selectCompactionTurnIds(useAppStore.getState(), "a");
	store.appendCompactionFailureUnlessObserved("a", beforeEarlyFailure, "host unavailable");
	expect(compactionTurns("a")).toMatchObject([{ status: "failed", detail: "host unavailable" }]);

	const beforePiFailure = selectCompactionTurnIds(useAppStore.getState(), "a");
	store.handlePiEvent(compactionStart("manual"), "a");
	store.handlePiEvent(
		compactionEnd({ reason: "manual", result: undefined, errorMessage: "Nothing to compact" }),
		"a",
	);
	store.appendCompactionFailureUnlessObserved("a", beforePiFailure, "request rejected");

	expect(compactionTurns("a")).toMatchObject([
		{ status: "failed", detail: "host unavailable" },
		{ status: "failed", detail: "Nothing to compact" },
	]);
});

test("a compaction_end with no observed start still lands a settled notice (connected mid-compaction)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(compactionEnd(), "a");
	expect(compactionTurns("a")).toMatchObject([
		{ status: "done", tokensBefore: 268_909, tokensAfter: 12_000 },
	]);
});

test("compact-and-retry produces one completion marker at final settlement", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEnd, "a");
	store.handlePiEvent(recoveredOverflow, "a");
	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").turns.filter((turn) => turn.kind === "system")).toHaveLength(0);

	store.handlePiEvent(agentSettled(), "a");
	expect(
		rt("a").turns.filter((turn) => turn.kind === "system" && turn.text === "✓ Done"),
	).toHaveLength(1);
});

test("appendErrorTurn surfaces a failed send (a rejected prompt) as a visible error turn", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.appendUserMessage("a", "do the thing");
	store.appendErrorTurn("a", "No API key configured for provider openai");

	const err = rt("a").turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("No API key");
	expect(failureRecovery("a")).toBeUndefined();
	expect(rt("a").isStreaming).toBe(false);
});

test("a message_update with no prior message_start still builds the turn (mid-stream hydration)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(assistantText("partial reply"), "a");
	expect(rt("a").turns.filter((t) => t.kind === "assistant")).toHaveLength(1);
	expect(rt("a").currentAssistantId).not.toBeNull();

	store.handlePiEvent(assistantText("partial reply"), "a");
	expect(rt("a").turns.filter((t) => t.kind === "assistant")).toHaveLength(1);
});

test("an event for an unknown session is a no-op (no runtime is conjured)", () => {
	const before = useAppStore.getState().sessions;
	useAppStore.getState().handlePiEvent(agentStart, "ghost");
	const after = useAppStore.getState().sessions;
	expect(after).toBe(before);
	expect(after.ghost).toBeUndefined();
});

test("closeChatRuntime drops only its own runtime", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	store.handlePiEvent(agentStart, "b");

	store.closeChatRuntime("a");
	expect(useAppStore.getState().sessions.a).toBeUndefined();
	expect(rt("b").isStreaming).toBe(true);
});

test("applyExtUi routes a dialog to its session; the reply clears only that one", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");

	const dialog: ExtUiRequest = {
		id: "d1",
		sessionId: "a",
		kind: "confirm",
		title: "Proceed?",
		message: "Apply?",
	};
	store.applyExtUi(dialog);
	expect(rt("a").pendingExtUi?.id).toBe("d1");
	expect(rt("b").pendingExtUi).toBeNull();

	store.clearPendingExtUi("a", "d1");
	expect(rt("a").pendingExtUi).toBeNull();
});

test("applyExtUi reads a notify's level: only an error becomes an error turn", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.applyExtUi({
		id: "n1",
		sessionId: "a",
		kind: "notify",
		message: "Just so you know",
		level: "info",
	});
	store.applyExtUi({
		id: "n2",
		sessionId: "a",
		kind: "notify",
		message: "Careful",
		level: "warning",
	});
	store.applyExtUi({
		id: "n3",
		sessionId: "a",
		kind: "notify",
		message: "Extension theme-probe.ts failed on session_start: theme.fg is not a function",
		level: "error",
	});

	expect(rt("a").turns.slice(-3)).toMatchObject([
		{ kind: "system", text: "Just so you know" },
		{ kind: "system", text: "Careful" },
		{
			kind: "error",
			text: "Extension theme-probe.ts failed on session_start: theme.fg is not a function",
		},
	]);
});

test("an ext-UI frame that beats its session.create response is replayed, not dropped", () => {
	const store = useAppStore.getState();

	store.applyExtUi({
		id: "s1",
		sessionId: "late",
		kind: "setStatus",
		key: "test",
		text: "Theme works",
	});
	store.applyExtUi({
		id: "n1",
		sessionId: "late",
		kind: "notify",
		message: "Extension theme-probe.ts failed on session_start: theme.fg is not a function",
		level: "error",
	});
	expect(useAppStore.getState().sessions.late).toBeUndefined();

	store.openChatSession("ws1", "late", null, "medium");

	expect(rt("late").extUiStatus).toEqual({ test: "Theme works" });
	expect(rt("late").turns.at(-1)).toMatchObject({
		kind: "error",
		text: "Extension theme-probe.ts failed on session_start: theme.fg is not a function",
	});
	expect(useAppStore.getState().extUiOrphans).toEqual([]);
});

test("a dialog for an unknown session is dropped, never replayed as a phantom", () => {
	const store = useAppStore.getState();

	store.applyExtUi({
		id: "d-late",
		sessionId: "dialog",
		kind: "confirm",
		title: "Proceed?",
		message: "Apply?",
	});
	expect(useAppStore.getState().extUiOrphans).toEqual([]);

	store.openChatSession("ws1", "dialog", null, "medium");
	expect(rt("dialog").pendingExtUi).toBeNull();
	expect(rt("dialog").extUiQueue).toEqual([]);
});

test("a frame for a chat closed to history still applies, and orphans stay bounded", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "closed", null, "medium");
	store.closeChatToHistory("closed", true, "ws1");

	store.applyExtUi({ id: "t1", sessionId: "closed", kind: "setTitle", title: "Renamed later" });
	const closed = useAppStore
		.getState()
		.closedChatsByWorkspace.ws1?.find((chat) => chat.sessionId === "closed");
	expect(closed?.title).toBe("Renamed later");
	expect(useAppStore.getState().extUiOrphans).toEqual([]);

	for (let i = 0; i < 70; i++) {
		store.applyExtUi({
			id: `f${i}`,
			sessionId: "never-opened",
			kind: "setStatus",
			key: "k",
			text: String(i),
		});
	}
	const orphans = useAppStore.getState().extUiOrphans;
	expect(orphans).toHaveLength(64);
	expect(orphans.at(-1)).toMatchObject({ id: "f69" });
});

test("a frame for a chat known only as a tab is buffered, never silently dropped", () => {
	const store = useAppStore.getState();
	useAppStore.setState({
		tabsByWorkspace: {
			ws1: [
				{
					kind: "chat",
					id: chatTabId("ws1", "tab-only"),
					workspaceId: "ws1",
					name: "Chat",
					sessionId: "tab-only",
				},
			],
		},
	});

	store.applyExtUi({
		id: "s1",
		sessionId: "tab-only",
		kind: "setStatus",
		key: "test",
		text: "Theme works",
	});

	expect(useAppStore.getState().sessions["tab-only"]).toBeUndefined();
	expect(useAppStore.getState().extUiOrphans).toMatchObject([{ id: "s1" }]);
});

test("a frame that beats a reopened chat's transcript is replayed by hydrateSession", () => {
	const store = useAppStore.getState();

	store.applyExtUi({
		id: "s1",
		sessionId: "reopened",
		kind: "setStatus",
		key: "test",
		text: "Theme works",
	});
	expect(useAppStore.getState().extUiOrphans).toMatchObject([{ id: "s1" }]);

	const summary: SessionSummary = {
		sessionId: "reopened",
		workspaceId: "ws1",
		title: "Chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		updatedAt: 0,
		live: true,
	};
	store.hydrateSession(summary, { turns: [], toolResults: {}, askAnswers: {} });

	expect(rt("reopened").extUiStatus).toEqual({ test: "Theme works" });
	expect(useAppStore.getState().extUiOrphans).toEqual([]);
});

test("setTitle refreshes shared chat metadata without requesting activation", () => {
	const store = useAppStore.getState();
	const cacheId = chatTabId("ws1", "a");
	const placementId = "legacy-chat-placement";
	store.openChatSession("ws1", "a", null, "medium");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "group",
					id: "center",
					tabs: [{ kind: "chat", id: placementId, name: "Chat", sessionId: "a" }],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
	});

	store.applyExtUi({ id: "title-1", sessionId: "a", kind: "setTitle", title: "Migration plan" });
	const state = useAppStore.getState();
	expect(state.tabsByWorkspace.ws1?.find((tab) => tab.id === cacheId)?.name).toBe("Migration plan");
	expect(state.layoutIntents).toHaveLength(1);
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "open",
		workspaceId: "ws1",
		intent: "keep",
		activate: false,
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});

	const staleDocument = state.layoutDocumentsByWorkspace.ws1;
	if (!staleDocument) throw new Error("missing title layout fixture");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				...staleDocument,
				center: {
					kind: "group",
					id: "center",
					tabs: [{ kind: "chat", id: placementId, name: "Stale", sessionId: "a" }],
				},
			},
		},
	});
	store.applyExtUi({ id: "title-1b", sessionId: "a", kind: "setTitle", title: "Migration plan" });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "open",
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});

	const cache = useAppStore.getState().tabsByWorkspace.ws1?.find((tab) => tab.id === cacheId);
	if (!cache) throw new Error("missing title cache fixture");
	useAppStore.setState({ layoutIntents: [] });
	store.openTab(cache, "keep", true, { activate: false });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({ tab: { id: cacheId } });
	store.applyExtUi({ id: "title-1c", sessionId: "a", kind: "setTitle", title: "Migration plan" });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "open",
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});
});

test("setTitle cannot restore a cache whose structural close is already accepted", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: { kind: "group", id: "center", tabs: [] },
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
	});
	store.applyExtUi({ id: "title-2", sessionId: "a", kind: "setTitle", title: "Closed title" });
	expect(useAppStore.getState().layoutIntents).toEqual([]);
	expect(useAppStore.getState().tabsByWorkspace.ws1?.[0]?.name).toBe("Closed title");
});

test("setTitle repairs the title of a still-live chat in local history", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.closeChatToHistory("a", true, "ws1");
	store.applyExtUi({ id: "title-3", sessionId: "a", kind: "setTitle", title: "Finished title" });
	expect(useAppStore.getState().closedChatsByWorkspace.ws1?.[0]?.title).toBe("Finished title");
});

test("a second dialog for a busy session queues instead of orphaning the first", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	const mk = (id: string): ExtUiRequest => ({
		id,
		sessionId: "a",
		kind: "input",
		title: "name?",
	});
	store.applyExtUi(mk("d1"));
	store.applyExtUi(mk("d2"));
	expect(rt("a").pendingExtUi?.id).toBe("d1");
	expect(rt("a").extUiQueue.map((q) => q.id)).toEqual(["d2"]);

	store.clearPendingExtUi("a", "d1");
	expect(rt("a").pendingExtUi?.id).toBe("d2");
	expect(rt("a").extUiQueue).toHaveLength(0);
});

test("closing a chat moves it to history with its runtime kept; reopening restores full state", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", null, "medium");
	store.handlePiEvent(agentStart, "a");
	useAppStore.setState({
		chatLocationRequest: {
			workspaceId: "ws1",
			projectId: "p1",
			sessionId: "a",
			messageIndex: 0,
			anchorText: "target",
		},
		historyOpenRequest: { id: "history-a", sessionId: "a" },
	});

	store.closeChatToHistory("a");
	let st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(false);
	expect(st.closedChatsByWorkspace.ws1?.map((c) => c.sessionId)).toEqual(["a"]);
	expect(st.sessions.a).toBeDefined();
	expect(st.sessions.a?.isStreaming).toBe(true);
	expect(st.chatLocationRequest).toBeNull();
	expect(st.historyOpenRequest).toBeNull();

	const activeAfterClose = st.activeTabByWorkspace.ws1;
	const placedId = "legacy:chat:a";
	store.restorePlacedChatCache("ws1", placedId, "a", "Restored chat");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((tab) => tab.id === placedId)).toBe(true);
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.activeTabByWorkspace.ws1).toBe(activeAfterClose);
	store.restorePlacedChatCache("ws1", placedId, "a", "Peer-renamed chat");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.find((tab) => tab.id === placedId)?.name).toBe(
		"Peer-renamed chat",
	);
	store.closeChatToHistory("a");
	expect(useAppStore.getState().closedChatsByWorkspace.ws1?.[0]?.title).toBe("Peer-renamed chat");

	store.reopenChat("ws1", "a");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(true);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "a"));
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.sessions.a?.isStreaming).toBe(true);
});

test("reopening a chat targets its captured workspace after the user switches away", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "captured", null, "medium");
	store.closeChatToHistory("captured");
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	store.reopenChat("ws1", "captured", { activate: false });
	const state = useAppStore.getState();
	expect(
		state.tabsByWorkspace.ws1?.some((tab) => tab.kind === "chat" && tab.sessionId === "captured"),
	).toBe(true);
	expect(state.tabsByWorkspace.ws2).toBeUndefined();
	expect(state.activeWorkspaceId).toBe("ws2");
});

test("deleteChat removes history/runtime state and falls back when deleting the active tab", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");

	store.closeChatToHistory("a");
	store.deleteChat("ws1", "a");
	let st = useAppStore.getState();
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.sessions.a).toBeUndefined();
	expect(st.skillsSyncedTickBySession.a).toBeUndefined();
	expect(st.sessions.b).toBeDefined();

	store.openChatSession("ws1", "c", null, "medium");
	const beforeNav = useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	store.deleteChat("ws1", "c");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "c")).toBe(false);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "b"));
	expect(st.navTickByWorkspace.ws1).toBe(beforeNav + 1);
	expect(st.sessions.c).toBeUndefined();
});

test("session-list reconciliation removes missed deletions without deleting a chat created mid-read", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "stale", null, "medium");
	const baseline = selectWorkspaceSessionIds(useAppStore.getState(), "ws1");

	store.openChatSession("ws1", "newcomer", null, "medium");
	store.reconcileWorkspaceSessions("ws1", baseline, []);

	const state = useAppStore.getState();
	expect(state.sessions.stale).toBeUndefined();
	expect(state.deletedSessionsByWorkspace.ws1?.stale).toBe(true);
	expect(
		state.tabsByWorkspace.ws1?.some((tab) => tab.kind === "chat" && tab.sessionId === "stale"),
	).toBe(false);
	expect(state.sessions.newcomer).toBeDefined();
	expect(state.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "newcomer"));
});

test("authoritative session reconciliation never impersonates user navigation", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "missing", null, "medium");
	const baseline = selectWorkspaceSessionIds(useAppStore.getState(), "ws1");
	const before = useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	store.reconcileWorkspaceSessions("ws1", baseline, []);
	const state = useAppStore.getState();
	expect(state.activeTabByWorkspace.ws1).toBeNull();
	expect(state.navTickByWorkspace.ws1 ?? 0).toBe(before);
});

test("session deletion drops queued chat and live-plan opens before pruning placement", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "queued", null, "medium");
	store.openDoc({
		kind: "plan",
		id: "queued-plan",
		workspaceId: "ws1",
		name: "Queued plan",
		sessionId: "queued",
	});
	store.deleteChat("ws1", "queued", false);
	const afterDeletion = useAppStore.getState();
	const intents = afterDeletion.layoutIntents;
	expect(afterDeletion.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(
		intents.some(
			(intent) =>
				intent.kind === "open" &&
				(intent.tab.kind === "chat" || intent.tab.kind === "plan") &&
				intent.tab.sessionId === "queued",
		),
	).toBe(false);
	expect(intents.at(-1)).toMatchObject({
		kind: "remove-session",
		workspaceId: "ws1",
		sessionId: "queued",
	});
});

test("a deletion that beats session.create prevents its late response from restoring the chat", () => {
	const store = useAppStore.getState();

	store.deleteChat("ws1", "late");
	store.openChatSession("ws1", "late", null, "medium");
	store.openTab(
		{
			kind: "chat",
			id: "late-cache",
			workspaceId: "ws1",
			name: "Late cache",
			sessionId: "late",
		},
		"keep",
		false,
	);
	store.openDoc({
		kind: "doc",
		id: "late-todo",
		workspaceId: "ws1",
		name: "Late TODO",
		content: "# Late",
		docPath: "TODO.md",
		sourceId: "late",
	});
	store.requestChatLocation({
		workspaceId: "ws1",
		projectId: "p1",
		sessionId: "late",
		messageIndex: 0,
		anchorText: "late",
	});
	store.requestHistoryOpen({ workspaceId: "ws1", sessionId: "late", tabId: "late" });

	const state = useAppStore.getState();
	expect(state.sessions.late).toBeUndefined();
	expect(state.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(
		state.layoutIntents.some((intent) => intent.kind === "open" && intent.workspaceId === "ws1"),
	).toBe(false);
	expect(state.chatLocationRequest).toBeNull();
	expect(state.historyOpenRequest).toBeNull();
});

test("a deletion that beats getMessages prevents its late hydrate from restoring the chat", () => {
	const store = useAppStore.getState();
	const summary: SessionSummary = {
		sessionId: "late",
		workspaceId: "ws1",
		title: "Deleted chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 1,
		updatedAt: 1,
		live: true,
	};

	store.deleteChat("ws1", "late");
	store.hydrateSession(summary, {
		turns: [],
		toolResults: {},
		askAnswers: {},
		turnIdByMessageIndex: [],
	});

	const state = useAppStore.getState();
	expect(state.sessions.late).toBeUndefined();
	expect(state.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
});

test("a page-lifetime deletion tombstone survives workspace cleanup until late hydration settles", () => {
	const store = useAppStore.getState();
	const summary: SessionSummary = {
		sessionId: "late",
		workspaceId: "ws1",
		title: "Deleted chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 1,
		updatedAt: 1,
		live: true,
	};

	store.deleteChat("ws1", "late");
	store.clearWorkspaceTabs("ws1");
	store.hydrateSession(summary, { turns: [], toolResults: {}, askAnswers: {} });

	expect(useAppStore.getState().sessions.late).toBeUndefined();
});

test("a deletion that beats session.list prevents its late history row from returning", () => {
	const store = useAppStore.getState();

	store.deleteChat("ws1", "late");
	store.noteClosedChats("ws1", [{ sessionId: "late", title: "Deleted chat", closedAt: 1 }]);

	expect(useAppStore.getState().closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
});

test("hydrateSession rebuilds a runtime + tab on connect, and never clobbers a live one", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const summary: SessionSummary = {
		sessionId: "h1",
		workspaceId: "ws1",
		title: "Chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 1,
		updatedAt: 0,
		live: true,
	};
	store.hydrateSession(summary, {
		turns: [{ kind: "user", id: "u1", message: { role: "user", content: "hi", timestamp: 0 } }],
		toolResults: {},
		askAnswers: {},
		turnIdByMessageIndex: ["u1"],
	});
	const st = useAppStore.getState();
	expect(st.sessions.h1?.turns).toHaveLength(1);
	expect(st.sessions.h1?.turnIdByMessageIndex).toEqual(["u1"]);
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "h1")).toBe(true);

	store.hydrateSession(
		{ ...summary, messageCount: 99 },
		{ turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] },
	);
	expect(useAppStore.getState().sessions.h1?.turns).toHaveLength(1);
});

test("reconcileSession replaces stale host state while preserving browser-local state", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "sync", null, "medium");
	store.setChatDraft("sync", "keep my draft");
	store.appendUserMessage("sync", "old summarized prompt");
	store.handlePiEvent(agentStart, "sync");
	store.handlePiEvent({ type: "compaction_start", reason: "overflow" }, "sync");
	store.handlePiEvent(
		{
			type: "compaction_end",
			reason: "overflow",
			result: { tokensBefore: 268_000, estimatedTokensAfter: 24_000 },
			aborted: false,
			willRetry: true,
		},
		"sync",
	);

	const before = rt("sync");
	const liveCompaction = before.turns.findLast((turn) => turn.kind === "compaction");
	if (liveCompaction?.kind !== "compaction") throw new Error("live compaction missing");
	const summary: SessionSummary = {
		sessionId: "sync",
		workspaceId: "ws1",
		title: "Chat",
		model: null,
		thinkingLevel: "high",
		isStreaming: true,
		messageCount: 2,
		updatedAt: 2,
		live: true,
		queue: { steering: [], followUp: ["continue afterward"] },
	};
	const applied = store.reconcileSession(
		summary,
		{
			turns: [
				{
					kind: "compaction",
					id: "persisted-compaction",
					status: "done",
					summary: "## Earlier work\nFinished the investigation.",
					tokensBefore: 268_000,
				},
			],
			toolResults: {},
			askAnswers: {},
			turnIdByMessageIndex: [null],
		},
		before.eventRevision,
		7,
	);

	expect(applied).toBe(true);
	const after = rt("sync");
	expect(after.turns).toHaveLength(1);
	expect(after.turns[0]).toEqual({
		kind: "compaction",
		id: liveCompaction.id,
		status: "done",
		summary: "## Earlier work\nFinished the investigation.",
		tokensBefore: 268_000,
		tokensAfter: 24_000,
		resuming: true,
	});
	expect(after.draft).toBe("keep my draft");
	expect(after.queue).toEqual({ steering: [], followUp: ["continue afterward"] });
	expect(after.thinkingLevel).toBe("high");
	expect(after.syncedConnectionGeneration).toBe(7);
	expect(after.eventRevision).toBe(before.eventRevision + 1);
});

test("reconcileSession rejects a transcript read crossed by even a UI-ignored Pi event", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "sync-race", null, "medium");
	store.appendUserMessage("sync-race", "keep this turn");
	const expectedRevision = rt("sync-race").eventRevision;

	store.handlePiEvent({ type: "turn_start" } as PiEvent, "sync-race");
	const crossed = rt("sync-race");
	expect(crossed.eventRevision).toBe(expectedRevision + 1);

	const applied = store.reconcileSession(
		{
			sessionId: "sync-race",
			workspaceId: "ws1",
			title: "Chat",
			model: null,
			thinkingLevel: "medium",
			isStreaming: false,
			messageCount: 0,
			updatedAt: 2,
			live: true,
		},
		{ turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] },
		expectedRevision,
		3,
	);

	expect(applied).toBe(false);
	expect(rt("sync-race").turns).toHaveLength(1);
	expect(rt("sync-race").syncedConnectionGeneration).not.toBe(3);
});

test("noteClosedChats surfaces disk-only sessions in history, skipping live/open/known ones", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "live1", null, "medium");

	store.noteClosedChats("ws1", [
		{ sessionId: "disk1", title: "Old chat", closedAt: 200 },
		{ sessionId: "disk2", title: "Older chat", closedAt: 100 },
		{ sessionId: "live1", title: "dup of open tab", closedAt: 300 },
	]);
	let history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history.map((c) => c.sessionId)).toEqual(["disk1", "disk2"]);

	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Old chat", closedAt: 200 }]);
	history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history).toHaveLength(2);
});

test("opening a chat never steals another resource's canonical cache id", () => {
	const collidingId = chatTabId("ws1", "collision-session");
	const file: FileTab = {
		kind: "file",
		id: collidingId,
		workspaceId: "ws1",
		name: "collision.ts",
		path: "collision.ts",
		content: "kept",
	};
	useAppStore.setState({ tabsByWorkspace: { ws1: [file] }, layoutIntents: [] });
	useAppStore.getState().openChatSession("ws1", "collision-session", null, "medium");
	const tabs = useAppStore.getState().tabsByWorkspace.ws1 ?? [];
	const openedChat = tabs.find((tab) => tab.kind === "chat");

	expect(tabs.find((tab) => tab.kind === "file")).toEqual(file);
	expect(openedChat?.sessionId).toBe("collision-session");
	expect(openedChat?.id).not.toBe(file.id);
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "open",
		tab: { id: openedChat?.id, sessionId: "collision-session" },
	});
});

test("restoring a stable chat placement never steals another resource's cache id", () => {
	const file = fileTab("ws1", "stable-placement-id");
	useAppStore.setState({ tabsByWorkspace: { ws1: [file] } });
	useAppStore.getState().restorePlacedChatCache("ws1", file.id, "collision-session", "Chat");
	const tabs = useAppStore.getState().tabsByWorkspace.ws1 ?? [];
	const restoredFile = tabs.find((tab) => tab.kind === "file");
	const restoredChat = tabs.find((tab) => tab.kind === "chat");

	expect(restoredFile).toEqual(file);
	expect(restoredChat?.sessionId).toBe("collision-session");
	expect(restoredChat?.id).not.toBe(file.id);
});

test("hydrateSession preserves the stable id of an already-restored shared placement", () => {
	const store = useAppStore.getState();
	const summary: SessionSummary = {
		sessionId: "legacy-session",
		workspaceId: "ws1",
		title: "Restored",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		updatedAt: 1,
		live: true,
	};
	store.restorePlacedChatCache("ws1", "legacy-placement-id", summary.sessionId, summary.title);
	store.hydrateSession(summary, { turns: [], toolResults: {}, askAnswers: {} }, false);
	const chats = useAppStore.getState().tabsByWorkspace.ws1?.filter((tab) => tab.kind === "chat");
	expect(chats).toHaveLength(1);
	expect(chats?.[0]?.id).toBe("legacy-placement-id");
});

test("hydrateSession(activate) reopens a disk-only chat: builds it, focuses it, and drops it from history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "other", null, "medium");
	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Old", closedAt: 1 }]);

	const summary: SessionSummary = {
		sessionId: "disk1",
		workspaceId: "ws1",
		title: "Old",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 2,
		updatedAt: 1,
		live: true,
	};
	store.hydrateSession(
		summary,
		{ turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] },
		true,
	);

	const st = useAppStore.getState();
	expect(st.sessions.disk1).toBeDefined();
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "disk1"));
});

test("clearWorkspaceTabs drops both open and closed chat runtimes + clears history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	store.closeChatToHistory("a");

	store.clearWorkspaceTabs("ws1");
	const st = useAppStore.getState();
	expect(st.sessions.a).toBeUndefined();
	expect(st.sessions.b).toBeUndefined();
	expect(st.closedChatsByWorkspace.ws1).toBeUndefined();
	expect(st.tabsByWorkspace.ws1).toBeUndefined();
});

test("requestChatLocation sets the jump deep link AND switches project+workspace atomically; clearChatLocation drops it", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ selectedProjectId: "p1", activeWorkspaceId: "ws1" });

	store.requestChatLocation({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "s1",
		messageIndex: 3,
		anchorText: "deploy the docs",
	});
	let st = useAppStore.getState();
	expect(st.chatLocationRequest).toEqual({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "s1",
		messageIndex: 3,
		anchorText: "deploy the docs",
	});
	expect(st.activeWorkspaceId).toBe("ws2");
	expect(st.selectedProjectId).toBe("p2");

	store.clearChatLocation();
	st = useAppStore.getState();
	expect(st.chatLocationRequest).toBeNull();
	expect(st.activeWorkspaceId).toBe("ws2");
	expect(st.selectedProjectId).toBe("p2");
});

test("requestChatLocation captures an already-hydrated destination before switching workspaces", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws2: {
				selectedByGroup: { destination: "chat" },
				lastFocusedCenterGroupId: "destination",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { destination: 4 },
			},
		},
	});
	useAppStore.getState().requestChatLocation({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "session",
		messageIndex: 1,
		anchorText: "target",
	});
	expect(useAppStore.getState().chatLocationRequest?.navigation).toEqual({
		groupId: "destination",
		clock: 5,
	});
	expect(
		useAppStore.getState().layoutAttentionByWorkspace.ws2?.navigationClockByGroup.destination,
	).toBe(5);
});

function project(over: Partial<Project> = {}): Project {
	return {
		id: "p1",
		name: "Project one",
		path: "/projects/one",
		slug: "project-one",
		lastOpened: 100,
		...over,
	};
}

test("installProjectSnapshot sorts both projections and repairs navigation after an off-screen close", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 200,
		closed: true,
	});
	const workspace = pushedWorkspace({ id: "w2", projectId: "p2" });
	const tabs = {
		w2: [{ kind: "file", id: "w2:a", workspaceId: "w2", name: "a", path: "a", content: "" }],
	} satisfies Record<string, FileTab[]>;
	useAppStore.setState({
		projects: [p2],
		recentProjects: [p2],
		workspaces: { p2: [workspace] },
		selectedProjectId: "p2",
		activeWorkspaceId: "w2",
		tabsByWorkspace: tabs,
	});

	useAppStore.getState().installProjectSnapshot([p1], [p1, p2]);

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
	expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.selectedProjectId).toBe("p1");
	expect(state.activeWorkspaceId).toBeNull();
	expect(state.workspaces.p2).toEqual([workspace]);
	expect(state.tabsByWorkspace).toBe(tabs);
});

test("projects-rail expansion: gestures reveal, restore stays neutral, the chevron toggles", () => {
	const p1 = project();
	const p2 = project({ id: "p2", name: "Project two", path: "/projects/two", slug: "project-two" });
	useAppStore.setState({ projects: [p1, p2], recentProjects: [p1, p2] });
	const store = useAppStore.getState();

	store.selectProject("p1");
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
	store.selectProject("p1", { reveal: true });
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p1: true });
	const before = useAppStore.getState().expandedProjectIds;
	store.expandProject("p1");
	expect(useAppStore.getState().expandedProjectIds).toBe(before);
	store.toggleProjectExpanded("p1");
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
	store.toggleProjectExpanded("p2");
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p2: true });
	useAppStore.getState().applyProjectUpdated({ ...p2, closed: true });
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
});

test("hydrateExpandedProjects seeds the persisted mirror; the welcome snapshot prunes to the open rail", () => {
	const p1 = project();
	useAppStore.getState().hydrateExpandedProjects(["p1", "stale-closed-project"]);
	expect(useAppStore.getState().expandedProjectIds).toEqual({
		p1: true,
		"stale-closed-project": true,
	});
	useAppStore.getState().installWelcomeSnapshot(1, [p1], [p1]);
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p1: true });
});

test("applyProjectUpdated closes a background project without moving the current workspace", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
	});
	useAppStore.setState({
		projects: [p1, p2],
		recentProjects: [p1, p2],
		workspaces: { p1: [pushedWorkspace()] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
	});

	useAppStore.getState().applyProjectUpdated({ ...p2, closed: true });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
	expect(state.recentProjects.find((candidate) => candidate.id === "p2")?.closed).toBe(true);
	expect(state.selectedProjectId).toBe("p1");
	expect(state.activeWorkspaceId).toBe("w1");
});

test("applyProjectUpdated closes the current project to the next Home and preserves its view maps", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
	});
	const workspace = pushedWorkspace();
	const tabs = {
		w1: [{ kind: "file", id: "w1:a", workspaceId: "w1", name: "a", path: "a", content: "" }],
	} satisfies Record<string, FileTab[]>;
	useAppStore.setState({
		projects: [p1, p2],
		recentProjects: [p1, p2],
		workspaces: { p1: [workspace] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		tabsByWorkspace: tabs,
	});

	useAppStore.getState().applyProjectUpdated({ ...p1, closed: true });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p2"]);
	expect(state.selectedProjectId).toBe("p2");
	expect(state.activeWorkspaceId).toBeNull();
	expect(state.workspaces.p1).toEqual([workspace]);
	expect(state.tabsByWorkspace).toBe(tabs);
});

test("applyProjectUpdated reopens and reorders the same project without duplicating it", () => {
	const p1 = project();
	const closed = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
		closed: true,
	});
	useAppStore.setState({ projects: [p1], recentProjects: [p1, closed] });
	const { closed: _closed, ...reopened } = closed;

	useAppStore.getState().applyProjectUpdated({ ...reopened, lastOpened: 200 });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.projects.filter((candidate) => candidate.id === "p2")).toHaveLength(1);
	expect(state.recentProjects[0]?.closed).toBeUndefined();
});

test("applyProjectUpdated closes the last project to the no-project state", () => {
	const p1 = project();
	useAppStore.setState({
		projects: [p1],
		recentProjects: [p1],
		selectedProjectId: "p1",
		activeWorkspaceId: null,
	});

	useAppStore.getState().applyProjectUpdated({ ...p1, closed: true });

	const state = useAppStore.getState();
	expect(state.projects).toEqual([]);
	expect(state.selectedProjectId).toBeNull();
	expect(state.activeWorkspaceId).toBeNull();
});

function pushedWorkspace(over: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1",
		projectId: "p1",
		name: "add-login-flow",
		branch: "add-login-flow",
		worktreePath: "/tmp/worktrees/p/workspace-1",
		baseBranch: "main",
		renamed: true,
		...over,
	};
}

test("project and workspace navigation update both scope ids atomically", () => {
	useAppStore.setState({ selectedProjectId: "p1", activeWorkspaceId: "w1" });
	const transitions: [string | null, string | null][] = [];
	const unsubscribe = useAppStore.subscribe((state) => {
		transitions.push([state.selectedProjectId, state.activeWorkspaceId]);
	});

	useAppStore.getState().selectProject("p2");
	expect(transitions).toEqual([["p2", null]]);

	transitions.length = 0;
	useAppStore.getState().activateWorkspace(pushedWorkspace({ id: "w3", projectId: "p3" }));
	expect(transitions).toEqual([["p3", "w3"]]);
	unsubscribe();
});

test("workspace selection history tracks ordinary, route, and history-search activation", () => {
	const w1 = pushedWorkspace();
	const w2 = pushedWorkspace({ id: "w2", projectId: "p2" });
	useAppStore.setState({
		projects: [project(), project({ id: "p2" })],
		workspaces: { p1: [w1], p2: [w2] },
	});

	useAppStore.getState().activateWorkspace(w1);
	useAppStore.getState().activateWorkspace(w2);
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);

	useAppStore.getState().activateWorkspaceFromRoute(w1);
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w1", "w2"]);

	useAppStore.getState().requestChatLocation({
		workspaceId: "w2",
		projectId: "p2",
		sessionId: "session",
		messageIndex: 0,
		anchorText: "target",
	});
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);

	useAppStore.getState().selectProject("p1");
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);
});

test("installWelcomeSnapshot lands one complete snapshot and advances its own generation", () => {
	const p1 = project();
	const closed = project({
		id: "p2",
		path: "/projects/two",
		slug: "two",
		lastOpened: 50,
		closed: true,
	});
	let notifications = 0;
	const unsubscribe = useAppStore.subscribe((state) => {
		notifications += 1;
		expect(state).toMatchObject({
			protocolVersion: 44,
			theme: "test-theme",
			welcomeGeneration: 1,
		});
		expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
		expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p1", "p2"]);
	});

	useAppStore.getState().installWelcomeSnapshot(44, [p1, closed], [p1, closed], {
		theme: "test-theme",
		analyticsEnabled: false,
		terminalReplayKb: 256,
	});
	unsubscribe();
	expect(notifications).toBe(1);

	useAppStore.getState().installWelcomeSnapshot(44, [p1], [p1]);
	expect(useAppStore.getState().welcomeGeneration).toBe(2);
});

test("installWelcomeSnapshot reconciles stale project navigation", () => {
	const p1 = project();
	useAppStore.setState({
		projects: [project({ id: "p2", path: "/projects/two", slug: "two" })],
		selectedProjectId: "p2",
		activeWorkspaceId: null,
	});

	useAppStore.getState().installWelcomeSnapshot(44, [p1], [p1]);
	expect(useAppStore.getState().selectedProjectId).toBe("p1");
});

test("activateWorkspaceFromRoute atomically stamps exact-chat intent", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] }, navTickByWorkspace: { w1: 3 } });

	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	expect(useAppStore.getState()).toMatchObject({
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		routeChatTarget: {
			workspaceId: "w1",
			sessionId: "s1",
			navTick: 4,
			navigation: null,
			validated: false,
		},
		routeChatTargetGeneration: 1,
	});

	useAppStore.getState().activateWorkspaceFromRoute(workspace);
	expect(useAppStore.getState().routeChatTarget).toBeNull();
	expect(selectWorkspaceNavTick(useAppStore.getState(), "w1")).toBe(5);
	expect(useAppStore.getState().routeChatTargetGeneration).toBe(1);
	const before = useAppStore.getState();
	useAppStore.getState().clearRouteChatTarget();
	expect(useAppStore.getState()).toBe(before);
});

test("closeChatToHistory keeps a route target for the closed session", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	useAppStore.getState().openChatSession("w1", "s1", null, "medium");
	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	const target = useAppStore.getState().routeChatTarget;
	expect(target?.sessionId).toBe("s1");

	useAppStore.getState().closeChatToHistory("s1", false, "w1", false);
	expect(useAppStore.getState().closedChatsByWorkspace.w1?.[0]?.sessionId).toBe("s1");
	expect(useAppStore.getState().routeChatTarget).toBe(target);
});

test("selectCurrentRouteChatTarget rejects overtaken or off-workspace intent", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())?.sessionId).toBe("s1");

	useAppStore.getState().noteNavigation("w1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())).toBeNull();

	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	useAppStore.getState().selectProject("p1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())).toBeNull();
});

test("updateWorkspace applies a pushed snapshot authoritatively: dropped fields clear", () => {
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					...pushedWorkspace(),
					diffBase: "release",
					skillOverrides: { "spec-graph": "off" },
					diffStats: { added: 3, removed: 1 },
				},
			],
		},
	});
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const ws = useAppStore.getState().workspaces.p1?.[0];
	expect(ws?.diffBase).toBeUndefined();
	expect(ws?.skillOverrides).toBeUndefined();
	expect(ws?.diffStats).toEqual({ added: 3, removed: 1 });
});

test("updateWorkspace applies the pushed snapshot by id, keeping the computed diffStats aggregate", () => {
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					...pushedWorkspace({ name: "workspace-1", branch: "workspace-1" }),
					renamed: undefined,
					diffStats: { added: 3, removed: 1 },
				},
			],
		},
	});
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const ws = useAppStore.getState().workspaces.p1?.[0];
	expect(ws?.name).toBe("add-login-flow");
	expect(ws?.renamed).toBe(true);
	expect(ws?.diffStats).toEqual({ added: 3, removed: 1 });
});

test("updateWorkspace is a no-op for a project whose list was never fetched", () => {
	useAppStore.setState({ workspaces: {} });
	useAppStore.getState().updateWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces).toEqual({});
});

test("updateWorkspace never appends an unknown id to a fetched list", () => {
	const existing = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [existing] } });
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const list = useAppStore.getState().workspaces.p1;
	expect(list).toHaveLength(1);
	expect(list?.[0]?.id).toBe("other");
});

test("removeWorkspace optimistically drops the row, leaving siblings; unknown project/id is a no-op", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [pushedWorkspace(), keep] } });

	useAppStore.getState().removeWorkspace("p1", "w1");
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other"]);

	useAppStore.getState().removeWorkspace("p1", "missing");
	expect(useAppStore.getState().workspaces.p1).toHaveLength(1);
	useAppStore.getState().removeWorkspace("p2", "w1");
	expect(useAppStore.getState().workspaces.p2).toBeUndefined();
});

test("addWorkspace upserts into a fetched list (append if absent, merge if present)", () => {
	const other = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [other] } });

	useAppStore.getState().addWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other", "w1"]);

	useAppStore.getState().addWorkspace(pushedWorkspace({ name: "renamed-later" }));
	const list = useAppStore.getState().workspaces.p1;
	expect(list).toHaveLength(2);
	expect(list?.find((w) => w.id === "w1")?.name).toBe("renamed-later");
});

test("addWorkspace is a no-op for a project whose list was never fetched", () => {
	useAppStore.setState({ workspaces: {} });
	useAppStore.getState().addWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces).toEqual({});
});

test("applyWorkspaceRemoved restores the most-recent workspace across projects", () => {
	const removed = pushedWorkspace();
	const previous = pushedWorkspace({ id: "w2", projectId: "p2", name: "previous" });
	useAppStore.setState({
		projects: [project(), project({ id: "p2" })],
		workspaces: { p1: [removed], p2: [previous] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		workspaceSelectionHistory: ["w1", "w2"],
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const state = useAppStore.getState();
	expect(state.activeWorkspaceId).toBe("w2");
	expect(state.selectedProjectId).toBe("p2");
	expect(state.workspaceSelectionHistory).toEqual(["w2"]);
	expect(state.toasts).toHaveLength(1);
});

test("applyWorkspaceRemoved skips missing, tombstoned, and closed-project history entries", () => {
	const removed = pushedWorkspace();
	const tombstoned = pushedWorkspace({ id: "tombstoned", projectId: "p3" });
	const closed = pushedWorkspace({ id: "closed", projectId: "p2" });
	const valid = pushedWorkspace({ id: "valid", projectId: "p3" });
	useAppStore.setState({
		projects: [project(), project({ id: "p3" })],
		workspaces: { p1: [removed], p2: [closed], p3: [tombstoned, valid] },
		removedWorkspaceIds: { tombstoned: true },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		workspaceSelectionHistory: ["w1", "missing", "tombstoned", "closed", "valid"],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	expect(useAppStore.getState().activeWorkspaceId).toBe("valid");
	expect(useAppStore.getState().selectedProjectId).toBe("p3");
});

test("applyWorkspaceRemoved drops the row, clears its tabs, and returns the active client to Welcome + toast when history is empty", () => {
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace()] },
		selectedProjectId: "stale-project",
		activeWorkspaceId: "w1",
		tabsByWorkspace: {
			w1: [{ kind: "file", id: "w1:a", workspaceId: "w1", name: "a", path: "a", content: "" }],
		},
		activeTabByWorkspace: { w1: "w1:a" },
		terminalsByWorkspace: {
			w1: [{ tabKey: "terminal-before-removal", workspaceId: "w1", title: "Terminal" }],
		},
		changesRequest: { workspaceId: "w1", path: "a", navTick: 0, navigation: null },
		specRequest: { workspaceId: "w1", path: "SPEC.md", navigation: null },
		chatLocationRequest: {
			workspaceId: "w1",
			projectId: "p1",
			sessionId: "removed-chat",
			messageIndex: 0,
			anchorText: "removed",
		},
		historyOpenRequest: { id: "history", sessionId: "removed-chat" },
		reviewFocusRequest: { workspaceId: "w1", commentId: "comment" },
		closedChatsByWorkspace: {
			w1: [{ sessionId: "removed-chat", title: "Removed", closedAt: 1 }],
		},
		toasts: [],
	});
	let cleanupSubscriberAttempted = false;
	const unsubscribe = useAppStore.subscribe((state, previous) => {
		if (
			cleanupSubscriberAttempted ||
			!previous.terminalsByWorkspace.w1 ||
			state.terminalsByWorkspace.w1
		) {
			return;
		}
		cleanupSubscriberAttempted = true;
		state.setWorkspaceTerminals("w1", [{ tabKey: "late-terminal", title: "Late terminal" }]);
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");
	unsubscribe();

	const s = useAppStore.getState();
	expect(cleanupSubscriberAttempted).toBe(true);
	expect(s.workspaces.p1).toEqual([]);
	expect(s.tabsByWorkspace.w1).toBeUndefined();
	expect(s.activeWorkspaceId).toBeNull();
	expect(s.selectedProjectId).toBe("p1");
	expect(s.toasts).toHaveLength(1);
	expect(s.toasts[0]?.message).toContain("add-login-flow");
	expect(s.changesRequest).toBeNull();
	expect(s.specRequest).toBeNull();
	expect(s.chatLocationRequest).toBeNull();
	expect(s.historyOpenRequest).toBeNull();
	expect(s.reviewFocusRequest).toBeNull();

	s.setLayoutAttention("w1", {
		selectedByGroup: {},
		lastFocusedCenterGroupId: "center",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: { center: 0 },
	});
	s.openTab({
		kind: "file",
		id: "late-file",
		workspaceId: "w1",
		name: "late",
		path: "late",
		content: "",
	});
	s.setWorkspaceTerminals("w1", [{ tabKey: "late-terminal", title: "Late terminal" }]);
	s.closeTerminalTab("w1", "late-terminal");
	s.setWorkspaceSpecs("w1", []);
	s.noteFsChanged({ workspaceId: "w1", paths: ["late"], truncated: false, skillChange: "none" });
	s.requestToolView("w1", "files");
	s.reconcileWorkspaceSessions("w1", ["removed-chat"], []);
	s.noteClosedChats("w1", [{ sessionId: "late-chat", title: "Late", closedAt: 2 }]);
	s.requestChatLocation({
		workspaceId: "w1",
		projectId: "p1",
		sessionId: "late-chat",
		messageIndex: 0,
		anchorText: "late",
	});
	s.activateWorkspace(pushedWorkspace());
	s.setWorkspaces("p1", [pushedWorkspace()]);
	const afterLateArrivals = useAppStore.getState();
	expect(afterLateArrivals.layoutDocumentsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.layoutAttentionByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.layoutIntents).toEqual([]);
	expect(afterLateArrivals.tabsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.closedChatsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.terminalsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.specsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.fsChangesByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.chatLocationRequest).toBeNull();
	expect(afterLateArrivals.activeWorkspaceId).toBeNull();
	expect(afterLateArrivals.workspaces.p1).toEqual([]);
});

test("applyWorkspaceRemoved on a non-active workspace drops the row silently (no toast, active untouched)", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace(), keep] },
		activeWorkspaceId: "other",
		workspaceSelectionHistory: ["other", "w1"],
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.workspaces.p1?.map((w) => w.id)).toEqual(["other"]);
	expect(s.activeWorkspaceId).toBe("other");
	expect(s.workspaceSelectionHistory).toEqual(["other"]);
	expect(s.toasts).toHaveLength(0);
});

test("applyWorkspaceRemoved drops the removed workspace's cached spec graph", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace(), keep] },
		activeWorkspaceId: "other",
		specsByWorkspace: { w1: [], other: [] },
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.specsByWorkspace.w1).toBeUndefined();
	expect(s.specsByWorkspace.other).toEqual([]);
});

test("requestChangesView / requestSpecView pair independent path requests with reveal intents", () => {
	useAppStore.setState({ changesRequest: null, specRequest: null, layoutIntents: [] });

	useAppStore.getState().requestChangesView("w1", "src/a.ts");
	useAppStore.getState().requestSpecView("w1", ".thinkrail/context/TASK-x.md");

	const s = useAppStore.getState();
	expect(s.changesRequest).toEqual({
		workspaceId: "w1",
		path: "src/a.ts",
		navTick: 1,
		navigation: null,
	});
	expect(s.specRequest).toEqual({
		workspaceId: "w1",
		path: ".thinkrail/context/TASK-x.md",
		navigation: null,
	});
	expect(
		s.layoutIntents.map(({ kind, workspaceId, ...intent }) => ({ kind, workspaceId, ...intent })),
	).toMatchObject([
		{ kind: "reveal-tool", workspaceId: "w1", tool: "changes" },
		{ kind: "reveal-tool", workspaceId: "w1", tool: "specs" },
	]);

	const first = useAppStore.getState().specRequest;
	useAppStore.getState().requestSpecView("w1", ".thinkrail/context/TASK-x.md");
	expect(useAppStore.getState().specRequest).not.toBe(first);
	expect(useAppStore.getState().specRequest).toEqual(first);
});

test("requestToolView reveals a tool without fabricating a path request", () => {
	useAppStore.setState({ layoutIntents: [], changesRequest: null, specRequest: null });

	useAppStore.getState().requestToolView("w1", "specs");

	const first = useAppStore.getState().layoutIntents[0];
	expect(first).toMatchObject({ kind: "reveal-tool", workspaceId: "w1", tool: "specs" });
	expect(useAppStore.getState().specRequest).toBeNull();
	expect(useAppStore.getState().changesRequest).toBeNull();

	useAppStore.getState().requestToolView("w1", "specs");
	const second = useAppStore.getState().layoutIntents[1];
	expect(second).toMatchObject({ kind: "reveal-tool", workspaceId: "w1", tool: "specs" });
	expect(second?.id).not.toBe(first?.id);
});

test("clearSpecRequest consumes the spec intent once — it opens a tab, so it must not replay", () => {
	useAppStore.setState({ specRequest: null, changesRequest: null });
	useAppStore.getState().requestSpecView("w1", "docs/SPEC.md");

	useAppStore.getState().clearSpecRequest();

	expect(useAppStore.getState().specRequest).toBeNull();
	useAppStore.getState().clearSpecRequest();
	expect(useAppStore.getState().specRequest).toBeNull();
	useAppStore.getState().requestChangesView("w1", "src/a.ts");
	useAppStore.getState().clearSpecRequest();
	expect(useAppStore.getState().changesRequest).toEqual({
		workspaceId: "w1",
		path: "src/a.ts",
		navTick: 2,
		navigation: null,
	});
});

test("the Changes deep link stamps the nav count at the click, so a later navigation still wins", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1", changesRequest: null, layoutIntents: [] });
	const s = () => useAppStore.getState();

	s().openTab(fileTab("ws1", "a.ts"), "keep");
	s().setActiveTab("ws1:a.ts");
	const beforeClick = selectWorkspaceNavTick(s(), "ws1");

	s().requestChangesView("ws1", "src/b.ts");
	expect(s().changesRequest?.navTick).toBe(beforeClick + 1);

	expect(selectWorkspaceNavTick(s(), "ws1")).toBe(s().changesRequest?.navTick);

	s().setActiveTab("ws1:a.ts");
	expect(selectWorkspaceNavTick(s(), "ws1")).not.toBe(s().changesRequest?.navTick);
});

test("legacy selection reconciliation does not count as user navigation", () => {
	useAppStore.setState({
		tabsByWorkspace: { ws1: [fileTab("ws1", "a.ts"), fileTab("ws1", "b.ts")] },
		activeTabByWorkspace: { ws1: "ws1:a.ts" },
		navTickByWorkspace: { ws1: 7 },
	});
	useAppStore.getState().syncLegacySelection("ws1", { kind: "editor", tabId: "ws1:b.ts" });
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBe("ws1:b.ts");
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(7);

	useAppStore.setState({
		terminalsByWorkspace: {
			ws1: [{ tabKey: "terminal", workspaceId: "ws1", title: "Terminal" }],
		},
	});
	useAppStore.getState().syncLegacySelection("ws1", {
		kind: "terminal",
		tabKey: "terminal",
	});
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBe("terminal");
	useAppStore.getState().syncLegacySelection("ws1", null);
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(7);
});

test("deferred center navigation clocks are isolated by destination group", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { a: "file-a", b: "file-b" },
				lastFocusedCenterGroupId: "a",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { a: 4, b: 9 },
			},
		},
	});

	const passive = captureCenterNavigation(useAppStore.getState(), "ws1");
	expect(passive).toEqual({ groupId: "a", clock: 4 });
	const fromA = useAppStore.getState().beginCenterNavigation("ws1");
	expect(fromA).toEqual({ groupId: "a", clock: 5 });
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(true);
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		activate: false,
		navigation: fromA,
	});
	useAppStore.setState({ activeWorkspaceId: "ws1" });

	useAppStore.getState().beginCenterNavigation("ws1", "b");
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(true);
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		activate: false,
		navigation: fromA,
	});
	const withOtherGroupFocused = useAppStore.getState().layoutAttentionByWorkspace.ws1;
	if (!withOtherGroupFocused) throw new Error("missing attention fixture");
	expect(shouldAdvanceAcceptedNavigation(withOtherGroupFocused, fromA)).toBe(false);

	useAppStore.getState().beginCenterNavigation("ws1", "a");
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(false);

	const withoutA = useAppStore.getState().layoutAttentionByWorkspace.ws1;
	if (!withoutA) throw new Error("missing attention fixture");
	const onlyB = {
		...withoutA,
		navigationClockByGroup: { b: withoutA.navigationClockByGroup.b ?? 0 },
	};
	useAppStore.setState({ layoutAttentionByWorkspace: { ws1: onlyB } });
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		navigation: fromA,
	});
	expect(shouldAdvanceAcceptedNavigation(onlyB, fromA)).toBe(true);
	const rerouted = useAppStore.getState().beginCenterNavigation("ws1", "removed-group");
	expect(rerouted?.groupId).toBe("b");
	expect(
		Object.hasOwn(
			useAppStore.getState().layoutAttentionByWorkspace.ws1?.navigationClockByGroup ?? {},
			"removed-group",
		),
	).toBe(false);
});

test("a request-time center navigation is not counted again when its chat cache lands", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: {},
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 3 },
			},
		},
		navTickByWorkspace: { ws1: 7 },
	});
	const navigation = useAppStore.getState().beginCenterNavigation("ws1");
	const afterRequest = useAppStore.getState().navTickByWorkspace.ws1;
	useAppStore
		.getState()
		.openChatSession(
			"ws1",
			"session-requested",
			null,
			"medium",
			undefined,
			layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", navigation),
		);

	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(afterRequest);
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "open",
		navigation,
	});
});

test("clearChangesRequest consumes the Changes intent once — it opens a diff tab, so it must not replay", () => {
	useAppStore.setState({ specRequest: null, changesRequest: null });
	useAppStore.getState().requestChangesView("w1", "src/a.ts");

	useAppStore.getState().clearChangesRequest();

	expect(useAppStore.getState().changesRequest).toBeNull();
	useAppStore.getState().requestSpecView("w1", "docs/SPEC.md");
	useAppStore.getState().clearChangesRequest();
	expect(useAppStore.getState().changesRequest).toBeNull();
	expect(useAppStore.getState().specRequest).toEqual({
		workspaceId: "w1",
		path: "docs/SPEC.md",
		navigation: null,
	});
});

const specNode = (over: Partial<SpecGraphNode> = {}): SpecGraphNode => ({
	id: "task-x",
	type: "task-spec",
	title: "X",
	path: ".thinkrail/context/TASK-x.md",
	dependsOn: [],
	references: [],
	implements: [],
	tags: [],
	...over,
});

test("setWorkspaceSpecs records a snapshot per workspace without touching its siblings", () => {
	const node = specNode();
	useAppStore.setState({ specsByWorkspace: { other: [] } });

	useAppStore.getState().setWorkspaceSpecs("w1", [node]);

	const s = useAppStore.getState();
	expect(s.specsByWorkspace.w1).toEqual([node]);
	expect(s.specsByWorkspace.other).toEqual([]);
});

test("setWorkspaceSpecs keeps the previous array identity when the re-read found no change", () => {
	useAppStore.setState({ specsByWorkspace: {} });
	useAppStore.getState().setWorkspaceSpecs("w1", [specNode()]);
	const first = useAppStore.getState().specsByWorkspace.w1;

	useAppStore.getState().setWorkspaceSpecs("w1", [specNode()]);
	expect(useAppStore.getState().specsByWorkspace.w1).toBe(first);

	useAppStore.getState().setWorkspaceSpecs("w1", [specNode({ status: "active" })]);
	expect(useAppStore.getState().specsByWorkspace.w1).not.toBe(first);

	const withStatus = useAppStore.getState().specsByWorkspace.w1;
	useAppStore.getState().setWorkspaceSpecs("w1", [specNode({ status: "active", tags: ["v1"] })]);
	expect(useAppStore.getState().specsByWorkspace.w1).not.toBe(withStatus);

	useAppStore.getState().setWorkspaceSpecs("w1", []);
	expect(useAppStore.getState().specsByWorkspace.w1).toEqual([]);
});

test("beginLogin opens a fresh active login; frames accumulate (url + paste prompt coexist)", () => {
	const s = useAppStore.getState();
	s.beginLogin("l1", "anthropic");
	expect(useAppStore.getState().activeLogin).toEqual({
		loginId: "l1",
		providerId: "anthropic",
		status: "active",
	});

	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "authUrl", url: "https://x/auth" },
	});
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "prompt", message: "Paste the code", placeholder: "code" },
	});
	expect(useAppStore.getState().activeLogin).toMatchObject({
		url: "https://x/auth",
		input: { kind: "prompt", message: "Paste the code", placeholder: "code" },
	});
});

test("a prompt frame's allowEmpty folds through (Copilot's blank-for-github.com GHE prompt)", () => {
	const s = useAppStore.getState();
	s.beginLogin("l1", "github-copilot");
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "github-copilot",
		frame: {
			kind: "prompt",
			message: "GitHub Enterprise URL/domain (blank for github.com)",
			placeholder: "company.ghe.com",
			allowEmpty: true,
		},
	});
	expect(useAppStore.getState().activeLogin?.input).toMatchObject({
		kind: "prompt",
		allowEmpty: true,
	});
});

test("a frame that beats the loginStart response creates the login; beginLogin then no-ops", () => {
	const s = useAppStore.getState();
	s.applyLoginFrame({
		loginId: "l9",
		providerId: "openai-codex",
		frame: { kind: "authUrl", url: "https://y" },
	});
	expect(useAppStore.getState().activeLogin).toMatchObject({ loginId: "l9", url: "https://y" });

	s.beginLogin("l9", "openai-codex");
	expect(useAppStore.getState().activeLogin).toMatchObject({ loginId: "l9", url: "https://y" });
});

test("frames for a different still-active login are ignored (modal — one at a time)", () => {
	const s = useAppStore.getState();
	s.beginLogin("l1", "anthropic");
	s.applyLoginFrame({
		loginId: "other",
		providerId: "google",
		frame: { kind: "authUrl", url: "https://nope" },
	});
	expect(useAppStore.getState().activeLogin).toMatchObject({
		loginId: "l1",
		providerId: "anthropic",
	});
	expect(useAppStore.getState().activeLogin?.url).toBeUndefined();
});

test("clearLoginInput drops the live input; success is terminal; clearLogin dismisses", () => {
	const s = useAppStore.getState();
	s.beginLogin("l1", "anthropic");
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "select", message: "Pick", options: [{ id: "max", label: "Max" }] },
	});
	expect(useAppStore.getState().activeLogin?.input).toBeDefined();

	s.clearLoginInput();
	expect(useAppStore.getState().activeLogin?.input).toBeUndefined();

	s.applyLoginFrame({ loginId: "l1", providerId: "anthropic", frame: { kind: "success" } });
	expect(useAppStore.getState().activeLogin?.status).toBe("success");

	s.clearLogin();
	expect(useAppStore.getState().activeLogin).toBeNull();
});

test("openSettings deep-links to a section (default providers); closeSettings hides it", () => {
	const s = useAppStore.getState();
	s.openSettings();
	expect(useAppStore.getState().settingsOpen).toBe(true);
	expect(useAppStore.getState().settingsSection).toBe("providers");

	s.openSettings("github");
	expect(useAppStore.getState().settingsSection).toBe("github");

	s.setSettingsSection("providers");
	expect(useAppStore.getState().settingsSection).toBe("providers");

	s.closeSettings();
	expect(useAppStore.getState().settingsOpen).toBe(false);
	expect(useAppStore.getState().settingsSection).toBe("providers");
});

test("an error frame is terminal: sets status/error and clears the live input + progress", () => {
	const s = useAppStore.getState();
	s.beginLogin("l1", "anthropic");
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "progress", message: "…" },
	});
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "prompt", message: "code" },
	});
	s.applyLoginFrame({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "error", message: "Scope revoked by provider" },
	});
	const login = useAppStore.getState().activeLogin;
	expect(login).toMatchObject({ status: "error", error: "Scope revoked by provider" });
	expect(login?.input).toBeUndefined();
	expect(login?.progress).toBeUndefined();
});

test("pushToast appends with a fresh id and dismissToast removes only that toast", () => {
	const store = useAppStore.getState();
	const id1 = store.pushToast({ variant: "error", message: "boom" });
	const id2 = store.pushToast({ variant: "info", message: "fyi", title: "Heads up" });
	expect(id1).not.toBe(id2);
	expect(useAppStore.getState().toasts).toMatchObject([
		{ id: id1, variant: "error", message: "boom" },
		{ id: id2, variant: "info", message: "fyi", title: "Heads up" },
	]);
	expect(useAppStore.getState().toasts[0]).not.toHaveProperty("title");

	store.dismissToast(id1);
	expect(useAppStore.getState().toasts).toMatchObject([{ id: id2 }]);
});

test("dismissToast for an unknown id is a no-op (same array ref, no churn)", () => {
	const store = useAppStore.getState();
	store.pushToast({ variant: "success", message: "done" });
	const before = useAppStore.getState().toasts;
	store.dismissToast("ghost");
	expect(useAppStore.getState().toasts).toBe(before);
});

test("pushToast coalesces an identical live toast (same variant/title/message) into the existing id", () => {
	const store = useAppStore.getState();
	const id1 = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	const twin = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	expect(twin).toBe(id1);
	expect(useAppStore.getState().toasts).toHaveLength(1);

	store.pushToast({ variant: "info", message: "boom", title: "Failed" });
	store.pushToast({ variant: "error", message: "boom" });
	expect(useAppStore.getState().toasts).toHaveLength(3);

	store.dismissToast(id1);
	const fresh = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	expect(fresh).not.toBe(id1);
	expect(useAppStore.getState().toasts).toHaveLength(3);
});

test("pushToast caps the queue, dropping the oldest", () => {
	const store = useAppStore.getState();
	const first = store.pushToast({ variant: "error", message: "toast 0" });
	for (let i = 1; i <= 5; i++) store.pushToast({ variant: "error", message: `toast ${i}` });
	const toasts = useAppStore.getState().toasts;
	expect(toasts).toHaveLength(5);
	expect(toasts.some((t) => t.id === first)).toBe(false);
	expect(toasts[0]?.message).toBe("toast 1");
	expect(toasts[4]?.message).toBe("toast 5");
});

test("the toast helper enqueues by variant and omits an absent title", () => {
	toast.success("saved");
	toast.error("nope", "Failed");
	expect(useAppStore.getState().toasts).toMatchObject([
		{ variant: "success", message: "saved" },
		{ variant: "error", message: "nope", title: "Failed" },
	]);
	expect(useAppStore.getState().toasts[0]).not.toHaveProperty("title");
});

test("applyConfig folds the server-synced app config in (theme is an opaque host-owned value)", () => {
	useAppStore.getState().applyConfig({ theme: "acme.solarized" });
	expect(useAppStore.getState().theme).toBe("acme.solarized");
	useAppStore.getState().applyConfig({ theme: "custom.high-contrast" });
	expect(useAppStore.getState().theme).toBe("custom.high-contrast");
});

test("applyConfig projects the composer growth limit", () => {
	useAppStore.getState().applyConfig({
		...DEFAULT_CONFIG,
		composerGrowthLimit: "roomy",
	});
	expect(useAppStore.getState()).toHaveProperty("composerGrowthLimit", "roomy");
});

test("diff tabs: openTab dedupes by id + activates; view + contents update in place", () => {
	const s = () => useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const tab = {
		kind: "diff" as const,
		id: "ws1:diff:branch:src/a.ts",
		workspaceId: "ws1",
		name: "a.ts",
		path: "src/a.ts",
		scope: { kind: "branch" } as const,
		original: "old",
		modified: "new",
		loadedTick: 1,
		loadedTarget: "main",
	};
	s().openTab(tab);
	s().openTab(tab);
	expect(s().tabsByWorkspace.ws1).toHaveLength(1);
	expect(s().activeTabByWorkspace.ws1).toBe(tab.id);

	s().setDiffTabView(tab.id, "inline");
	const afterView = s().tabsByWorkspace.ws1?.[0];
	expect(afterView?.kind === "diff" && afterView.view).toBe("inline");
	s().setFileTabView(tab.id, "source");
	const guarded = s().tabsByWorkspace.ws1?.[0];
	expect(guarded?.kind === "diff" && guarded.view).toBe("inline");

	s().setDiffTabIgnoreWhitespace(tab.id, true);
	const afterWs = s().tabsByWorkspace.ws1?.[0];
	expect(afterWs?.kind === "diff" && afterWs.ignoreWhitespace).toBe(true);

	s().updateDiffTabContent("ws1", tab.id, "old2", "new2", 5, "origin/release");
	const updated = s().tabsByWorkspace.ws1?.[0];
	expect(updated?.kind).toBe("diff");
	if (updated?.kind === "diff") {
		expect(updated.original).toBe("old2");
		expect(updated.modified).toBe("new2");
		expect(updated.loadedTick).toBe(5);
		expect(updated.loadedTarget).toBe("origin/release");
	}
});

test("live content updates are scoped when two workspaces reuse an opaque cache id", () => {
	useAppStore.setState({
		tabsByWorkspace: {
			ws1: [
				{
					kind: "file",
					id: "legacy-placement",
					workspaceId: "ws1",
					name: "one",
					path: "one",
					content: "one",
				},
			],
			ws2: [
				{
					kind: "file",
					id: "legacy-placement",
					workspaceId: "ws2",
					name: "two",
					path: "two",
					content: "two",
				},
			],
		},
	});
	useAppStore.getState().updateFileTabContent("ws2", "legacy-placement", "fresh", 4);
	expect(useAppStore.getState().tabsByWorkspace.ws1?.[0]?.content).toBe("one");
	expect(useAppStore.getState().tabsByWorkspace.ws2?.[0]?.content).toBe("fresh");
});

test("the diff scope is per workspace, defaults to the branch, and is dropped with the workspace", () => {
	const s = () => useAppStore.getState();
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					id: "ws1",
					projectId: "p1",
					name: "ws1",
					branch: "b",
					worktreePath: "/wt",
					baseBranch: "main",
				},
			],
		},
		activeWorkspaceId: "ws1",
		selectedProjectId: "p1",
	});
	expect(selectDiffScope(s(), "ws1")).toBe(selectDiffScope(s(), "ws2"));
	expect(selectDiffScope(s(), "ws1")).toEqual({ kind: "branch" });

	s().setDiffScope("ws1", { kind: "commit", sha: "abc123" });
	expect(selectDiffScope(s(), "ws1")).toEqual({ kind: "commit", sha: "abc123" });
	expect(selectDiffScope(s(), "ws2")).toEqual({ kind: "branch" });

	s().applyWorkspaceRemoved("p1", "ws1");
	expect(s().diffScopeByWorkspace.ws1).toBeUndefined();
});

const skillFs = (
	workspaceId: string,
	paths: string[],
	skillChange: WorkspaceSkillChange = "detected",
	truncated = false,
): WorkspaceFsChangedPayload => ({ workspaceId, paths, truncated, skillChange });
const isStale = (workspaceId: string, sessionId: string) =>
	selectSkillsStale(useAppStore.getState(), workspaceId, sessionId);

test("skills badge: a skill-dir change flags the loaded session; reload clears it for good", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	expect(isStale("ws1", "a")).toBe(true);

	expect(isStale("ws1", "a")).toBe(true);

	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", ["src/app.ts"], "none"));
	s().noteFsChanged(skillFs("ws1", ["README.md"], "none"));
	expect(isStale("ws1", "a")).toBe(false);
});

test("skills badge: the skill-change tick is accumulated, so a later non-skill batch can't lose it", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().noteFsChanged(skillFs("ws1", ["src/app.ts"], "none"));
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: a pathless skill-neutral repo-metadata nudge refreshes without staling", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");
	s().noteFsChanged(skillFs("ws1", [], "none"));
	expect(selectWorkspaceTick(s(), "ws1")).toBe(1);
	expect(isStale("ws1", "a")).toBe(false);
});

test("skills badge: generic path overflow is neutral, but detected and unknown skill impact flags", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");

	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "none", true));
	expect(selectWorkspaceTick(s(), "ws1")).toBe(1);
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "detected", true));
	expect(isStale("ws1", "a")).toBe(true);
	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));

	s().noteFsChanged(skillFs("ws1", [], "unknown", true));
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: non-skill overflow during session creation does not open the new chat stale", () => {
	const s = () => useAppStore.getState();
	s().noteFsChanged(skillFs("ws1", [], "unknown", true));
	const baseline = selectWorkspaceTick(s(), "ws1");
	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "none", true));
	s().openChatSession("ws1", "new", null, "medium", baseline);
	expect(isStale("ws1", "new")).toBe(false);
});

test("skills badge: per session — a chat opened after the change isn't flagged; reload clears only its own", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().openChatSession("ws1", "b", null, "medium");
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(false);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(true);

	s().markSkillsSynced("b", selectWorkspaceTick(s(), "ws1"));
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(false);
});

test("skills badge: a skill change mid-reload stays flagged (baseline is captured at reload start)", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");
	const reloadBaseline = selectWorkspaceTick(s(), "ws1");
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().markSkillsSynced("a", reloadBaseline);
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: closing a chat runtime drops its sync baseline (no leak)", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));
	expect(s().skillsSyncedTickBySession.a).toBeDefined();

	s().closeChatRuntime("a");
	expect(s().skillsSyncedTickBySession.a).toBeUndefined();
});

test("skills badge: markSkillsSynced is monotonic and ignores a disposed session", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", null, "medium");

	s().markSkillsSynced("a", 5);
	s().markSkillsSynced("a", 2);
	expect(s().skillsSyncedTickBySession.a).toBe(5);

	s().closeChatRuntime("a");
	s().markSkillsSynced("a", 9);
	expect(s().skillsSyncedTickBySession.a).toBeUndefined();
});

const summaryFor = (sessionId: string, live: boolean): SessionSummary => ({
	sessionId,
	workspaceId: "ws1",
	title: "Chat",
	model: null,
	thinkingLevel: "medium",
	isStreaming: false,
	messageCount: 0,
	updatedAt: 0,
	live,
});

test("skills badge: a LIVE restore stays conservatively stale; a disk attach anchors to its load tick", () => {
	const s = () => useAppStore.getState();
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));

	s().hydrateSession(summaryFor("live1", true), { turns: [], toolResults: {}, askAnswers: {} });
	expect(isStale("ws1", "live1")).toBe(true);

	s().hydrateSession(
		summaryFor("disk1", false),
		{ turns: [], toolResults: {}, askAnswers: {} },
		false,
		selectWorkspaceTick(s(), "ws1"),
	);
	expect(isStale("ws1", "disk1")).toBe(false);
});

test("explicitly passive hydration never becomes navigation just because the cache has no active tab", () => {
	const store = useAppStore.getState();
	store.hydrateSession(
		summaryFor("passive", true),
		{ turns: [], toolResults: {}, askAnswers: {} },
		false,
		undefined,
		{ activate: false },
	);
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeUndefined();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBeUndefined();
});

function fileTab(workspaceId: string, name: string): FileTab {
	return { kind: "file", id: `${workspaceId}:${name}`, workspaceId, name, path: name, content: "" };
}

test("a preview open replaces the previous preview tab at its index (the strip never reshuffles)", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");
	store.openTab(fileTab("ws1", "c.ts"), "keep");

	store.openTab(fileTab("ws1", "d.ts"), "preview");

	const s = useAppStore.getState();
	expect((s.tabsByWorkspace.ws1 ?? []).map((t) => t.name)).toEqual(["a.ts", "d.ts", "c.ts"]);
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:d.ts");
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:d.ts");
});

test("hydrated per-group previews never evict one another from the render cache", () => {
	const document: WorkspaceLayoutDocument = {
		version: 2,
		center: { kind: "group", id: "center-a", tabs: [] },
		left: { visible: false, width: 0.18, groups: [] },
		right: { visible: false, width: 0.28, groups: [] },
		bottom: emptyBottomRegion(),
		toolRestoreTargets: {},
	};
	useAppStore.setState({ layoutDocumentsByWorkspace: { ws1: document } });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	expect((useAppStore.getState().tabsByWorkspace.ws1 ?? []).map((tab) => tab.name)).toEqual([
		"a.ts",
		"b.ts",
	]);
});

test("a preview open of an already-kept tab focuses it without demoting it or moving the slot", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	store.openTab(fileTab("ws1", "a.ts"), "preview");

	const s = useAppStore.getState();
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:b.ts");
	expect(s.tabsByWorkspace.ws1).toHaveLength(2);
});

test("keep releases the slot — through openTab, through setActiveTab, and through closeTab", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();

	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.setActiveTab("ws1:a.ts", "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();

	store.openTab(fileTab("ws1", "b.ts"), "preview");
	store.openTab(fileTab("ws1", "b.ts"), "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();

	store.openTab(fileTab("ws1", "c.ts"), "preview");
	store.closeTab("ws1:c.ts");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();
});

test("promotion is one-way: neither a plain activation nor a keep elsewhere demotes a tab", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	store.setActiveTab("ws1:a.ts");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBe("ws1:b.ts");

	store.setActiveTab("ws1:a.ts", "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBe("ws1:b.ts");
});

test("the slot is per workspace — clearWorkspaceTabs releases only its own", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws2", "b.ts"), "preview");

	store.clearWorkspaceTabs("ws1");

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBeUndefined();
	expect(s.previewTabByWorkspace.ws2).toBe("ws2:b.ts");
});

test("chat, document, and plan tabs never enter the preview slot", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");

	store.openChatSession("ws1", "s1", null, "medium");
	store.openDoc({
		kind: "doc",
		id: "ws1:plan",
		workspaceId: "ws1",
		name: "Plan",
		content: "# plan",
		docPath: "plan.md",
		sourceId: "s1",
	});
	store.openTab(
		{
			kind: "chat",
			id: "direct-chat",
			workspaceId: "ws1",
			name: "Direct chat",
			sessionId: "s2",
		},
		"preview",
	);
	store.openDoc({
		kind: "plan",
		id: "ws1:live-plan",
		workspaceId: "ws1",
		name: "Live plan",
		sessionId: "s3",
	});

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.tabsByWorkspace.ws1).toHaveLength(5);
	expect(s.layoutIntents.at(-1)).toMatchObject({ kind: "open", intent: "keep" });
});

test("a keep on an already-open tab releases ITS workspace's slot, never the active one's", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws2", "b.ts"), "preview");
	useAppStore.setState({ activeWorkspaceId: "ws2" });

	store.openTab(fileTab("ws1", "a.ts"), "keep");

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBeUndefined();
	expect(s.previewTabByWorkspace.ws2).toBe("ws2:b.ts");
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.activeTabByWorkspace.ws2).toBe("ws2:b.ts");
});

test("every center navigation bumps the workspace's nav tick, and none of them bypass it", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const tick = () => useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	const missed: string[] = [];
	const bumps = (label: string, act: () => void) => {
		const before = tick();
		act();
		if (tick() <= before) missed.push(label);
	};

	const s = () => useAppStore.getState();
	const beforeOpen = tick();
	s().openTab(fileTab("ws1", "a.ts"), "preview");
	s().openTab(fileTab("ws1", "a.ts"), "keep");
	expect(tick()).toBe(beforeOpen);

	bumps("setActiveTab", () => s().setActiveTab("ws1:a.ts"));
	bumps("openDoc", () =>
		s().openDoc({
			kind: "doc",
			id: "ws1:plan",
			workspaceId: "ws1",
			name: "Plan",
			content: "# p",
			docPath: "plan.md",
			sourceId: "s1",
		}),
	);
	bumps("openChatSession", () => s().openChatSession("ws1", "sess", null, "medium"));
	bumps("closeChatToHistory", () => s().closeChatToHistory("sess"));
	bumps("reopenChat", () => s().reopenChat("ws1", "sess"));
	s().setActiveTab("ws1:a.ts");
	bumps("closeTab", () => s().closeTab("ws1:a.ts"));
	bumps("noteNavigation", () => s().noteNavigation("ws1"));
	bumps("requestHistoryOpen", () =>
		s().requestHistoryOpen({ sessionId: "sess", workspaceId: "ws1", tabId: "ws1:sess" }),
	);
	expect(s().layoutIntents.at(-1)).toMatchObject({ kind: "select", focus: false });
	expect(missed).toEqual([]);

	useAppStore.setState({ activeTabByWorkspace: { ws1: "ws1:sess" } });
	const before = tick();
	s().hydrateSession(
		{
			sessionId: "bg",
			workspaceId: "ws1",
			title: "bg",
			createdAt: 0,
			updatedAt: 0,
			live: true,
		} as unknown as SessionSummary,
		{ turns: [], toolResults: {}, askAnswers: {} },
	);
	expect(tick()).toBe(before);

	expect(useAppStore.getState().navTickByWorkspace.ws2).toBeUndefined();
	s().clearWorkspaceTabs("ws1");
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBeUndefined();
});

test("history selection resolves a cache alias to its stable shared placement id", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "history-alias", null, "medium");
	const cache = useAppStore
		.getState()
		.tabsByWorkspace.ws1?.find((tab) => tab.kind === "chat" && tab.sessionId === "history-alias");
	if (!cache) throw new Error("missing history cache fixture");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "group",
					id: "history-group",
					tabs: [
						{
							kind: "chat",
							id: "legacy-history-placement",
							name: "History",
							sessionId: "history-alias",
						},
					],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { "history-group": "legacy-history-placement" },
				lastFocusedCenterGroupId: "history-group",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "history-group": 0 },
			},
		},
	});
	store.requestHistoryOpen({
		workspaceId: "ws1",
		sessionId: "history-alias",
		tabId: cache.id,
	});
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "select",
		tabId: "legacy-history-placement",
		resource: { kind: "chat", sessionId: "history-alias" },
		focus: false,
	});
});

test("history selection never uses a colliding cache id as shared placement identity", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "history-collision", null, "medium");
	const chat = useAppStore
		.getState()
		.tabsByWorkspace.ws1?.find(
			(tab) => tab.kind === "chat" && tab.sessionId === "history-collision",
		);
	if (!chat) throw new Error("missing colliding history cache fixture");
	const collidingId = "opaque-collision";
	useAppStore.setState({
		layoutIntents: [],
		tabsByWorkspace: { ws1: [{ ...chat, id: collidingId }] },
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "split",
					id: "history-split",
					direction: "horizontal",
					weights: [0.5, 0.5],
					children: [
						{ kind: "group", id: "history-origin", tabs: [] },
						{
							kind: "group",
							id: "history-collision-group",
							tabs: [{ kind: "file", id: collidingId, name: "other.ts", path: "other.ts" }],
						},
					],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { "history-collision-group": collidingId },
				lastFocusedCenterGroupId: "history-origin",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "history-origin": 0, "history-collision-group": 0 },
			},
		},
	});
	store.requestHistoryOpen({
		workspaceId: "ws1",
		sessionId: "history-collision",
		tabId: collidingId,
	});
	const state = useAppStore.getState();
	expect(state.layoutIntents.at(-1)).toMatchObject({
		kind: "select",
		resource: { kind: "chat", sessionId: "history-collision" },
		navigation: { groupId: "history-origin", clock: 1 },
	});
	expect(state.layoutAttentionByWorkspace.ws1?.lastFocusedCenterGroupId).toBe("history-origin");
	expect(state.layoutAttentionByWorkspace.ws1?.navigationClockByGroup["history-origin"]).toBe(1);
	expect(
		state.layoutAttentionByWorkspace.ws1?.navigationClockByGroup["history-collision-group"],
	).toBe(0);
});

test("an accepted background close removes the cache from its captured workspace", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	store.closeTab("ws1:a.ts", false, false, "ws1");
	expect(useAppStore.getState().tabsByWorkspace.ws1).toEqual([]);
	expect(useAppStore.getState().tabsByWorkspace.ws2).toBeUndefined();
});

test("a close that moves no focus is not a navigation — it can't discard a browse in flight", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const s = () => useAppStore.getState();
	const tick = () => s().navTickByWorkspace.ws1 ?? 0;

	s().openTab(fileTab("ws1", "a.ts"), "keep");
	s().openTab(fileTab("ws1", "b.ts"), "keep");
	s().openChatSession("ws1", "sess", null, "medium");
	s().setActiveTab("ws1:b.ts");
	const before = tick();

	s().closeTab("ws1:a.ts");
	expect(tick()).toBe(before);
	expect(s().activeTabByWorkspace.ws1).toBe("ws1:b.ts");

	s().closeChatToHistory("sess");
	expect(tick()).toBe(before);
	expect(s().activeTabByWorkspace.ws1).toBe("ws1:b.ts");

	s().closeTab("ws1:b.ts");
	expect(tick()).toBeGreaterThan(before);
});

test("terminal creation can capture a center-group destination without creating a second authority", () => {
	useAppStore.setState({
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: {},
				lastFocusedCenterGroupId: "center-a",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "center-a": 1, "center-b": 3 },
			},
		},
	});
	useAppStore.getState().addTerminal("w1", undefined, "center-b");
	const state = useAppStore.getState();
	expect(state.terminalsByWorkspace.w1).toHaveLength(1);
	expect(state.layoutIntents).toHaveLength(1);
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		targetGroupId: "center-b",
	});
	expect(state.layoutAttentionByWorkspace.w1).toMatchObject({
		lastFocusedCenterGroupId: "center-b",
		navigationClockByGroup: { "center-a": 1, "center-b": 4 },
	});
	expect(state.navTickByWorkspace.w1).toBe(1);
});

test("terminal creation can target bottom without advancing center navigation", () => {
	const attention = {
		selectedByGroup: {},
		lastFocusedCenterGroupId: "center-a",
		lastFocusedSideGroupId: { bottom: "bottom-a" },
		navigationClockByGroup: { "center-a": 2 },
	};
	useAppStore.setState({ layoutAttentionByWorkspace: { w1: attention } });
	useAppStore.getState().addTerminal("w1", undefined, "bottom-b", "bottom");
	const state = useAppStore.getState();
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		targetGroupId: "bottom-b",
		targetArea: "bottom",
	});
	expect(state.layoutAttentionByWorkspace.w1).toBe(attention);
	expect(state.navTickByWorkspace.w1).toBeUndefined();
});

test("the host catalog confirms a reservation while retaining its one-shot command", () => {
	useAppStore.getState().addTerminal("w1", "code .", "bottom-a", "bottom");
	const pending = useAppStore.getState().terminalsByWorkspace.w1?.[0];
	if (!pending) throw new Error("missing pending terminal");
	expect(pending.reservationPending).toBe(true);

	useAppStore
		.getState()
		.setWorkspaceTerminals("w1", [{ tabKey: pending.tabKey, title: "Host title" }]);
	expect(useAppStore.getState().terminalsByWorkspace.w1).toEqual([
		{
			tabKey: pending.tabKey,
			workspaceId: "w1",
			title: "Host title",
			initialCommand: "code .",
		},
	]);
	expect(useAppStore.getState().layoutIntents).toHaveLength(1);
});

test("hidden terminal seeding stays non-activating, idempotent, and atomically rejectable", () => {
	useAppStore
		.getState()
		.addTerminal("w1", undefined, "bottom-a", "bottom", false, "initial-terminal");
	useAppStore
		.getState()
		.addTerminal("w1", undefined, "bottom-a", "bottom", false, "initial-terminal");
	const pending = useAppStore.getState().terminalsByWorkspace.w1?.[0];
	if (!pending) throw new Error("missing pending terminal");
	expect(useAppStore.getState().terminalsByWorkspace.w1).toHaveLength(1);
	expect(useAppStore.getState().layoutIntents).toHaveLength(1);
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		tabKey: pending.tabKey,
		targetGroupId: "bottom-a",
		targetArea: "bottom",
		reveal: false,
	});

	useAppStore.getState().rejectTerminalReservation("w1", pending.tabKey);
	expect(useAppStore.getState().terminalsByWorkspace.w1).toEqual([]);
	expect(useAppStore.getState().layoutIntents).toEqual([]);
});

test("catalog authority falls with the list it describes — only an awaited refresh sets it", () => {
	const s = () => useAppStore.getState();
	const listed = [{ id: "opus-5", name: "opus-5", provider: "anthropic" }] as WireModel[];
	const refreshed = [{ id: "opus-6", name: "opus-6", provider: "anthropic" }] as WireModel[];

	s().setModelsForProviderVersion(s().providerVersion, listed);
	expect(s().modelsFresh).toBe(false);

	const settledVersion = s().beginModelsRefresh();
	s().finishModelsRefresh(settledVersion, { models: refreshed, complete: true });
	expect(s().models).toBe(refreshed);
	expect(s().modelsRefreshing).toBe(false);
	expect(s().modelsFresh).toBe(true);

	s().setModelsForProviderVersion(s().providerVersion, listed);
	expect(s().models).toBe(listed);
	expect(s().modelsFresh).toBe(false);

	s().finishModelsRefresh(s().providerVersion, { models: refreshed, complete: true });
	const failedVersion = s().beginModelsRefresh();
	s().finishModelsRefresh(failedVersion, null);
	expect(s().models).toBe(refreshed);
	expect(s().modelsFresh).toBe(true);
});

test("a provider invalidation rejects every stale model reply", () => {
	const s = () => useAppStore.getState();
	const listed = [
		{ id: "central-model", name: "central-model", provider: "central" },
	] as WireModel[];
	const before = s().beginModelsRefresh();
	s().finishModelsRefresh(before, { models: listed, complete: true });

	s().noteProviderChanged();
	expect(s().providerVersion).toBe(before + 1);
	expect(s().models).toEqual([]);
	expect(s().modelsFresh).toBe(false);
	expect(s().modelsRefreshing).toBe(false);

	s().setModelsForProviderVersion(before, listed);
	s().finishModelsRefresh(before, { models: listed, complete: true });
	expect(s().models).toEqual([]);
	expect(s().modelsFresh).toBe(false);
});

test("a refresh whose wait was capped installs its list but claims no authority", () => {
	const s = () => useAppStore.getState();
	const listed = [{ id: "opus-5", name: "opus-5", provider: "anthropic" }] as WireModel[];
	const unsettled = [{ id: "opus-6", name: "opus-6", provider: "anthropic" }] as WireModel[];
	const settledVersion = s().beginModelsRefresh();
	s().finishModelsRefresh(settledVersion, { models: listed, complete: true });
	expect(s().modelsFresh).toBe(true);

	const unsettledVersion = s().beginModelsRefresh();
	s().finishModelsRefresh(unsettledVersion, { models: unsettled, complete: false });
	expect(s().models).toBe(unsettled);
	expect(s().modelsRefreshing).toBe(false);
	expect(s().modelsFresh).toBe(false);
});

test("authority can be given up without replacing the list (a consumer activating)", () => {
	const s = () => useAppStore.getState();
	const refreshed = [{ id: "opus-6", name: "opus-6", provider: "anthropic" }] as WireModel[];
	const providerVersion = s().beginModelsRefresh();
	s().finishModelsRefresh(providerVersion, { models: refreshed, complete: true });
	expect(s().modelsFresh).toBe(true);

	s().dropModelsFreshness();
	expect(s().modelsFresh).toBe(false);
	expect(s().models).toBe(refreshed);
});
