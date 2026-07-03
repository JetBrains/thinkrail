import { expect, test } from "bun:test";
import { phaseLabel, streamStatus } from "./StreamIndicator";
import type { ChatTurn } from "./types";

type Block =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

function assistant(id: string, content: Block[]): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: true,
		message: { role: "assistant", content },
	} as unknown as ChatTurn;
}

const user: ChatTurn = {
	kind: "user",
	id: "u1",
	message: { role: "user", content: "hi", timestamp: 0 },
};

test("no in-flight assistant turn → working (the post-send gap)", () => {
	expect(streamStatus([user], null)).toEqual({ phase: "working" });
	// id reserved (message_start) but the turn's first update hasn't landed yet.
	expect(streamStatus([user], "a1")).toEqual({ phase: "working" });
});

test("an empty (content-less) in-flight turn is still just working", () => {
	expect(streamStatus([assistant("a1", [])], "a1")).toEqual({ phase: "working" });
});

test("thinking / writing come from the active turn's last block", () => {
	expect(streamStatus([assistant("a1", [{ type: "thinking", thinking: "hmm" }])], "a1")).toEqual({
		phase: "thinking",
	});
	expect(streamStatus([assistant("a1", [{ type: "text", text: "Here is" }])], "a1")).toEqual({
		phase: "writing",
	});
});

test("blank thinking/text hasn't really started → working (avoids a phantom label)", () => {
	expect(streamStatus([assistant("a1", [{ type: "thinking", thinking: "  " }])], "a1")).toEqual({
		phase: "working",
	});
	expect(streamStatus([assistant("a1", [{ type: "text", text: "" }])], "a1")).toEqual({
		phase: "working",
	});
});

test("a trailing tool call surfaces the tool name for the loader", () => {
	const turn = assistant("a1", [
		{ type: "thinking", thinking: "let me look" },
		{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
	]);
	expect(streamStatus([turn], "a1")).toEqual({ phase: "running-tool", toolName: "bash" });
});

test("after message_end (no current id) the phase falls back to the round's trailing assistant turn", () => {
	// A tool-calling message has completed (message_end cleared currentAssistantId) and its tool is now
	// executing — the loader must keep naming the tool, not degrade to "Working…".
	const turn = assistant("a1", [
		{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
	]);
	expect(streamStatus([turn], null)).toEqual({ phase: "running-tool", toolName: "bash" });
	// …but a user turn at the tail is a fresh post-send gap — no stale phase from the previous round.
	expect(streamStatus([turn, user], null)).toEqual({ phase: "working" });
});

test("status tracks the turn named by currentAssistantId, not merely the last turn", () => {
	const turns = [
		assistant("a1", [{ type: "toolCall", id: "t1", name: "read", arguments: {} }]),
		assistant("a2", [{ type: "text", text: "answering" }]),
	];
	// a1 is stale (finalized); a2 is the live one.
	expect(streamStatus(turns, "a2")).toEqual({ phase: "writing" });
});

test("phaseLabel names every phase (and falls back to a generic tool label)", () => {
	expect(phaseLabel({ phase: "working" })).toBe("Working…");
	expect(phaseLabel({ phase: "thinking" })).toBe("Thinking…");
	expect(phaseLabel({ phase: "writing" })).toBe("Writing…");
	expect(phaseLabel({ phase: "running-tool", toolName: "bash" })).toBe("Running bash…");
	expect(phaseLabel({ phase: "running-tool" })).toBe("Running tool…");
});
