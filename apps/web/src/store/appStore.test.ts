import { beforeEach, expect, test } from "bun:test";
import type { ExtUiRequest, PiEvent, SessionSummary, Workspace } from "@thinkrail/contracts";
import { type SessionRuntime, toast, useAppStore } from "./appStore";

// Event fixtures — the reducer only reads the fields below, so casting minimal objects is safe here.
const agentStart = { type: "agent_start" } as unknown as PiEvent;
const agentEnd = { type: "agent_end", willRetry: false, messages: [] } as unknown as PiEvent;
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
// A turn that ends in a provider/model error: retries exhausted (or non-retryable), so `willRetry` is
// false and the run's last assistant message carries `stopReason: "error"` + the provider's `errorMessage`
// (this is what a bad model like a nonexistent "gpt-5.5" produces — a 404/model-not-found from the API).
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
// A streaming `text` update carries the cumulative `partial` snapshot (the assistant message so far).
const assistantText = (text: string) =>
	({
		type: "message_update",
		assistantMessageEvent: {
			type: "text",
			partial: { role: "assistant", content: [{ type: "text", text }] },
		},
	}) as unknown as PiEvent;

beforeEach(() => {
	useAppStore.setState({
		sessions: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		closedChatsByWorkspace: {},
		selectedProjectId: null,
		activeWorkspaceId: null,
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

test("pi events route to the right session runtime; chats stay independent", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "high");

	// A starts streaming + runs a tool; none of it leaks into B.
	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(toolStart("t1"), "a");
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("a").toolResults.t1?.status).toBe("running");
	expect(rt("b").isStreaming).toBe(false);
	expect(Object.keys(rt("b").toolResults)).toHaveLength(0);

	// B starts streaming while A is still streaming — both run at once.
	store.handlePiEvent(agentStart, "b");
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("b").isStreaming).toBe(true);

	// A finishes; B keeps streaming and gains no "Done" notice of its own.
	store.handlePiEvent(agentEnd, "a");
	expect(rt("a").isStreaming).toBe(false);
	expect(rt("a").turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
	expect(rt("b").isStreaming).toBe(true);
	expect(rt("b").turns).toHaveLength(0);
});

test("an assistant turn is built (and replaced, not duplicated) from message_update partials", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a"); // reserves currentAssistantId
	store.handlePiEvent(assistantText("po"), "a");
	store.handlePiEvent(assistantText("pong"), "a"); // replaces the prior snapshot

	const assistants = rt("a").turns.filter((t) => t.kind === "assistant");
	expect(assistants).toHaveLength(1); // replaced, not accumulated
	const turn = assistants[0];
	expect(turn?.kind === "assistant" && turn.streaming).toBe(true);
	expect(turn?.kind === "assistant" && turn.message.content[0]?.type === "text").toBe(true);

	store.handlePiEvent(agentEnd, "a");
	const after = rt("a");
	expect(after.isStreaming).toBe(false);
	expect(after.currentAssistantId).toBeNull();
	expect(after.turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
});

test("a multi-message turn leaves no assistant turn flagged streaming (no stray live indicator)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// pi splits one run into several assistant messages (one per tool round) and does NOT send each a
	// terminal `done`. Message A streams, then message B starts before A ever concludes.
	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(assistantStart, "a");
	store.handlePiEvent(assistantText("first"), "a"); // A: streaming
	store.handlePiEvent(assistantStart, "a"); // B starts — A must be finalized here
	expect(rt("a").turns.filter((t) => t.kind === "assistant" && t.streaming)).toHaveLength(0);
	store.handlePiEvent(assistantText("second"), "a"); // B: streaming
	const streamingMid = rt("a").turns.filter((t) => t.kind === "assistant" && t.streaming);
	expect(streamingMid).toHaveLength(1); // exactly one turn is ever live at a time

	// The run ends without B getting a `done` either — agent_end must sweep the flag off every turn, or a
	// blinking cursor lingers in the transcript after "✓ Done".
	store.handlePiEvent(agentEnd, "a");
	const after = rt("a");
	expect(after.turns.filter((t) => t.kind === "assistant")).toHaveLength(2);
	expect(after.turns.some((t) => t.kind === "assistant" && t.streaming)).toBe(false);
	expect(after.isStreaming).toBe(false);
});

test("message_end finalizes the turn the moment its message completes (not at agent_end)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// pi forwards only *streaming* variants as message_update — a message's real terminal is message_end.
	// The distinction matters most for a tool-calling message: its tools run AFTER it completes (for
	// ask_user_question, until the user answers), and the card gates Submit on the turn's streaming flag —
	// were the flag to survive until agent_end, an interactive tool could never be answered.
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
	expect(after.isStreaming).toBe(true); // the ROUND is still live (its tool is executing)
	expect(after.currentAssistantId).toBeNull();
	const turn = after.turns.find((t) => t.kind === "assistant");
	expect(turn?.kind === "assistant" && turn.streaming).toBe(false); // …but the MESSAGE is final
	// The final message (with stopReason — how renderers spot dead tool calls) replaced the partial.
	expect(turn?.kind === "assistant" && turn.message.stopReason).toBe("toolUse");

	// A non-assistant message_end (toolResult/user) is a no-op for the turn list.
	const before = rt("a");
	store.handlePiEvent(
		{ type: "message_end", message: { role: "toolResult" } } as unknown as PiEvent,
		"a",
	);
	expect(rt("a")).toBe(before);
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

	// Unknown customTypes are ignored without touching the runtime ref.
	const before = rt("a");
	store.handlePiEvent(
		{
			type: "message_end",
			message: { role: "custom", customType: "other", content: "x", display: false },
		} as unknown as PiEvent,
		"a",
	);
	expect(rt("a")).toBe(before);
});

test("the tool lifecycle folds into toolResults (the status + raw the renderers read)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// start → running, no result yet.
	store.handlePiEvent(toolStart("t1"), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "running", raw: undefined });

	// update → still running, carries the partial snapshot (REPLACE semantics).
	const partial = { content: [{ type: "text", text: "partial" }] };
	store.handlePiEvent(toolUpdate("t1", partial), "a");
	expect(rt("a").toolResults.t1).toEqual({ status: "running", raw: partial });

	// end (ok) → done, carries the final result.
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
	expect(retry?.kind === "retry" && retry.attempt).toBe(2);
	expect(retry?.kind === "retry" && retry.maxAttempts).toBe(3);
	expect(retry?.kind === "retry" && retry.delayMs).toBe(5_000);

	// auto_retry_end removes it — the retried attempt's streaming/answer takes over.
	store.handlePiEvent(retryEnd, "a");
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
});

test("a lingering retry countdown is swept up by the final agent_end", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	store.handlePiEvent(retryStart(1, 3, 1_000), "a");
	store.handlePiEvent(agentEnd, "a"); // willRetry: false → conclude
	expect(rt("a").turns.some((t) => t.kind === "retry")).toBe(false);
	expect(rt("a").turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(true);
});

test("a turn that ends in a provider error surfaces the error (not a false ✓ Done)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// Reproduces "pick a bad model → nothing happens": the run streams no content and ends in an error.
	store.handlePiEvent(agentStart, "a");
	store.handlePiEvent(agentEndError("model 'gpt-5.5' not found"), "a");

	const after = rt("a");
	expect(after.isStreaming).toBe(false);
	// The failure must be visible — an error turn carrying the provider message.
	const err = after.turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("gpt-5.5");
	// And it must NOT masquerade as a successful "✓ Done".
	expect(after.turns.some((t) => t.kind === "system" && t.text === "✓ Done")).toBe(false);
});

test("appendErrorTurn surfaces a failed send (a rejected prompt) as a visible error turn", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// A `session.prompt`/`session.create` rejection (e.g. `prompt()` throwing "no API key") must land in
	// the chat instead of being swallowed by a bare `.catch(() => {})`.
	store.appendUserMessage("a", "do the thing");
	store.appendErrorTurn("a", "No API key configured for provider openai");

	const err = rt("a").turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("No API key");
	expect(rt("a").isStreaming).toBe(false);
});

test("a message_update with no prior message_start still builds the turn (mid-stream hydration)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");

	// Hydrated mid-stream: we missed message_start, so currentAssistantId is null. A streaming update must
	// still adopt the in-flight turn (and set currentAssistantId so later cumulative updates land on it).
	store.handlePiEvent(assistantText("partial reply"), "a");
	expect(rt("a").turns.filter((t) => t.kind === "assistant")).toHaveLength(1);
	expect(rt("a").currentAssistantId).not.toBeNull();

	// A terminal `done` then clears it.
	store.handlePiEvent(assistantText("partial reply") /* still streaming */, "a");
	expect(rt("a").turns.filter((t) => t.kind === "assistant")).toHaveLength(1); // same turn, replaced
});

test("an event for an unknown session is a no-op (no runtime is conjured)", () => {
	const before = useAppStore.getState().sessions;
	useAppStore.getState().handlePiEvent(agentStart, "ghost");
	const after = useAppStore.getState().sessions;
	expect(after).toBe(before); // withRuntime returns {} → same sessions ref
	expect(after.ghost).toBeUndefined();
});

test("closeChatRuntime drops only its own runtime", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	store.handlePiEvent(agentStart, "b");

	store.closeChatRuntime("a");
	expect(useAppStore.getState().sessions.a).toBeUndefined();
	expect(rt("b").isStreaming).toBe(true); // the other session is untouched
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

	// Answering d1 promotes d2 to the head.
	store.clearPendingExtUi("a", "d1");
	expect(rt("a").pendingExtUi?.id).toBe("d2");
	expect(rt("a").extUiQueue).toHaveLength(0);
});

test("closing a chat moves it to history with its runtime kept; reopening restores full state", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", null, "medium");
	store.handlePiEvent(agentStart, "a"); // give the runtime live state to prove it survives close

	store.closeChatToHistory("a");
	let st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(false);
	expect(st.closedChatsByWorkspace.ws1?.map((c) => c.sessionId)).toEqual(["a"]);
	expect(st.sessions.a).toBeDefined(); // runtime NOT disposed
	expect(st.sessions.a?.isStreaming).toBe(true);

	store.reopenChat("a");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(true);
	expect(st.activeTabByWorkspace.ws1).toBe("ws1:a");
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0); // removed from history on reopen
	expect(st.sessions.a?.isStreaming).toBe(true); // full transcript/state intact
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
	});
	const st = useAppStore.getState();
	expect(st.sessions.h1?.turns).toHaveLength(1);
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "h1")).toBe(true);

	// A second hydrate (e.g. stale list) must NOT overwrite the now-live runtime.
	store.hydrateSession(
		{ ...summary, messageCount: 99 },
		{ turns: [], toolResults: {}, askAnswers: {} },
	);
	expect(useAppStore.getState().sessions.h1?.turns).toHaveLength(1);
});

test("noteClosedChats surfaces disk-only sessions in history, skipping live/open/known ones", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "live1", null, "medium"); // a live, open tab

	store.noteClosedChats("ws1", [
		{ sessionId: "disk1", title: "Old chat", closedAt: 200 },
		{ sessionId: "disk2", title: "Older chat", closedAt: 100 },
		{ sessionId: "live1", title: "dup of open tab", closedAt: 300 }, // already open → skipped
	]);
	let history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history.map((c) => c.sessionId)).toEqual(["disk1", "disk2"]); // newest-first, live1 excluded

	// Idempotent: re-noting the same disk sessions adds nothing.
	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Old chat", closedAt: 200 }]);
	history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history).toHaveLength(2);
});

test("hydrateSession(activate) reopens a disk-only chat: builds it, focuses it, and drops it from history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "other", null, "medium"); // an existing active tab
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
	store.hydrateSession(summary, { turns: [], toolResults: {}, askAnswers: {} }, true);

	const st = useAppStore.getState();
	expect(st.sessions.disk1).toBeDefined(); // runtime built from the re-opened session
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0); // left history (it's open now)
	expect(st.activeTabByWorkspace.ws1).toBe("ws1:disk1"); // focused, despite an existing active tab
});

test("clearWorkspaceTabs drops both open and closed chat runtimes + clears history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", null, "medium");
	store.openChatSession("ws1", "b", null, "medium");
	store.closeChatToHistory("a"); // a → history (runtime kept), b stays an open tab

	store.clearWorkspaceTabs("ws1");
	const st = useAppStore.getState();
	expect(st.sessions.a).toBeUndefined();
	expect(st.sessions.b).toBeUndefined();
	expect(st.closedChatsByWorkspace.ws1).toBeUndefined();
	expect(st.tabsByWorkspace.ws1).toBeUndefined();
});

// ---- updateWorkspace: the workspace.updated push folds in without losing local computed state ----

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

test("updateWorkspace merges the pushed snapshot by id, keeping the computed diffStats badge", () => {
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
	expect(ws?.diffStats).toEqual({ added: 3, removed: 1 }); // the push carries none — merge keeps it
});

test("updateWorkspace is a no-op for a project whose list was never fetched", () => {
	useAppStore.setState({ workspaces: {} });
	useAppStore.getState().updateWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces).toEqual({});
});

test("updateWorkspace never appends an unknown id to a fetched list", () => {
	const existing = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [existing] } });
	useAppStore.getState().updateWorkspace(pushedWorkspace()); // id w1 — not in the list

	const list = useAppStore.getState().workspaces.p1;
	expect(list).toHaveLength(1);
	expect(list?.[0]?.id).toBe("other");
});

test("removeWorkspace optimistically drops the row, leaving siblings; unknown project/id is a no-op", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [pushedWorkspace(), keep] } });

	useAppStore.getState().removeWorkspace("p1", "w1");
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other"]);

	// Unknown id leaves the list untouched; an unfetched project is a no-op (no empty list conjured).
	useAppStore.getState().removeWorkspace("p1", "missing");
	expect(useAppStore.getState().workspaces.p1).toHaveLength(1);
	useAppStore.getState().removeWorkspace("p2", "w1");
	expect(useAppStore.getState().workspaces.p2).toBeUndefined();
});

// ---- addWorkspace: the workspace.created push upserts by id ----------------------------------------

test("addWorkspace upserts into a fetched list (append if absent, merge if present)", () => {
	const other = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [other] } });

	useAppStore.getState().addWorkspace(pushedWorkspace()); // id w1 — new row appended
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other", "w1"]);

	// Re-applying the same id merges in place (idempotent with the creator's own post-create re-list).
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

// ---- applyWorkspaceRemoved: the workspace.removed reaction, run by every client --------------------

test("applyWorkspaceRemoved drops the row, clears its tabs, and returns the active client to Welcome + toast", () => {
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace()] },
		selectedProjectId: "stale-project",
		activeWorkspaceId: "w1",
		tabsByWorkspace: {
			w1: [{ kind: "file", id: "w1:a", workspaceId: "w1", name: "a", path: "a", content: "" }],
		},
		activeTabByWorkspace: { w1: "w1:a" },
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.workspaces.p1).toEqual([]);
	expect(s.tabsByWorkspace.w1).toBeUndefined(); // clearWorkspaceTabs dropped its tabs
	expect(s.activeWorkspaceId).toBeNull(); // shell falls back to the project Welcome
	expect(s.selectedProjectId).toBe("p1"); // specifically the removed workspace's owning Project Home
	expect(s.toasts).toHaveLength(1);
	expect(s.toasts[0]?.message).toContain("add-login-flow"); // the removed workspace's name
});

test("applyWorkspaceRemoved on a non-active workspace drops the row silently (no toast, active untouched)", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace(), keep] },
		activeWorkspaceId: "other",
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.workspaces.p1?.map((w) => w.id)).toEqual(["other"]);
	expect(s.activeWorkspaceId).toBe("other"); // a background removal doesn't move the client
	expect(s.toasts).toHaveLength(0);
});

// --- in-app login (flat, session-less) -------------------------------------------------------------

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
	// The browser-vs-paste race: the URL and the paste input are live at the same time.
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
	// Without allowEmpty carried through, the dialog would refuse to submit a blank github.com answer.
	expect(useAppStore.getState().activeLogin?.input).toMatchObject({
		kind: "prompt",
		allowEmpty: true,
	});
});

test("a frame that beats the loginStart response creates the login; beginLogin then no-ops", () => {
	const s = useAppStore.getState();
	// Provider fired onAuth synchronously → the frame arrives before beginLogin.
	s.applyLoginFrame({
		loginId: "l9",
		providerId: "openai-codex",
		frame: { kind: "authUrl", url: "https://y" },
	});
	expect(useAppStore.getState().activeLogin).toMatchObject({ loginId: "l9", url: "https://y" });

	// The late beginLogin for the same id must not clobber the folded state.
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

	s.clearLoginInput(); // sent a reply → hide the input immediately (no double-submit)
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
	// The section is remembered across close/open (not reset).
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
	// Oldest-first, and the optional title is carried only when given.
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

	// Any field differing → a distinct toast.
	store.pushToast({ variant: "info", message: "boom", title: "Failed" });
	store.pushToast({ variant: "error", message: "boom" });
	expect(useAppStore.getState().toasts).toHaveLength(3);

	// Once the twin is dismissed, the same content enqueues fresh (with a new id).
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
	// The themes module resolves/applies it; the store preserves exactly the id received from the host.
	useAppStore.getState().applyConfig({ theme: "acme.solarized" });
	expect(useAppStore.getState().theme).toBe("acme.solarized");
	useAppStore.getState().applyConfig({ theme: "custom.high-contrast" });
	expect(useAppStore.getState().theme).toBe("custom.high-contrast");
});

test("diff tabs: openTab dedupes by id + activates; view + contents update in place", () => {
	const s = () => useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const tab = {
		kind: "diff" as const,
		id: "ws1:diff:src/a.ts",
		workspaceId: "ws1",
		name: "a.ts",
		path: "src/a.ts",
		original: "old",
		modified: "new",
		loadedTick: 1,
	};
	s().openTab(tab);
	s().openTab(tab); // re-open = no duplicate, stays active
	expect(s().tabsByWorkspace.ws1).toHaveLength(1);
	expect(s().activeTabByWorkspace.ws1).toBe(tab.id);

	// Split ↔ inline is per-tab state; a wrong-kind id is a no-op.
	s().setDiffTabView(tab.id, "inline");
	const afterView = s().tabsByWorkspace.ws1?.[0];
	expect(afterView?.kind === "diff" && afterView.view).toBe("inline");
	s().setFileTabView(tab.id, "source"); // kind-guarded: must not touch the diff tab
	const guarded = s().tabsByWorkspace.ws1?.[0];
	expect(guarded?.kind === "diff" && guarded.view).toBe("inline");

	// A live re-read replaces both sides and advances the tick.
	s().updateDiffTabContent(tab.id, "old2", "new2", 5);
	const updated = s().tabsByWorkspace.ws1?.[0];
	expect(updated?.kind).toBe("diff");
	if (updated?.kind === "diff") {
		expect(updated.original).toBe("old2");
		expect(updated.modified).toBe("new2");
		expect(updated.loadedTick).toBe(5);
	}
});
