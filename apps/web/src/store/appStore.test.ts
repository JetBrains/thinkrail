import { beforeEach, expect, test } from "bun:test";
import type { ExtUiRequest, PiEvent } from "@thinkrail-pi/contracts";
import { type SessionRuntime, useAppStore } from "./appStore";

// Event fixtures — the reducer only reads the fields below, so casting minimal objects is safe here.
const agentStart = { type: "agent_start" } as unknown as PiEvent;
const agentEnd = { type: "agent_end", willRetry: false, messages: [] } as unknown as PiEvent;
const toolStart = (toolCallId: string) =>
	({ type: "tool_execution_start", toolCallId, toolName: "bash" }) as unknown as PiEvent;
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
	useAppStore.setState({ sessions: {}, tabsByWorkspace: {}, activeTabByWorkspace: {} });
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
