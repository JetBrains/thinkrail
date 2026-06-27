import { beforeEach, expect, test } from "bun:test";
import type { ExtUiRequest, PiEvent, SessionSummary } from "@thinkrail-pi/contracts";
import { type SessionRuntime, useAppStore } from "./appStore";

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
		activeWorkspaceId: null,
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
	store.hydrateSession(
		summary,
		[{ kind: "user", id: "u1", message: { role: "user", content: "hi", timestamp: 0 } }],
		{},
	);
	const st = useAppStore.getState();
	expect(st.sessions.h1?.turns).toHaveLength(1);
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "h1")).toBe(true);

	// A second hydrate (e.g. stale list) must NOT overwrite the now-live runtime.
	store.hydrateSession({ ...summary, messageCount: 99 }, [], {});
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
	store.hydrateSession(summary, [], {}, true);

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
