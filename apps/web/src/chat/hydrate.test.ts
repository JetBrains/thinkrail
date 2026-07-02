import { expect, test } from "bun:test";
import type { Message } from "@thinkrail-pi/contracts";
import { messagesToRuntime } from "./hydrate";

// Partial fixtures cast to Message — the converter reads only `role` (+ toolCallId/isError/content for
// tool results) and passes user/assistant messages through verbatim.
const messages = [
	{ role: "user", content: "do it", timestamp: 1 },
	{ role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }] },
	{
		role: "toolResult",
		toolCallId: "tc1",
		toolName: "bash",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 3,
	},
	{ role: "assistant", content: [{ type: "text", text: "finished" }] },
] as unknown as Message[];

test("messagesToRuntime folds a transcript into ordered turns + a toolResults map", () => {
	const { turns, toolResults } = messagesToRuntime(messages);

	// user/assistant become turns in order; toolResult does NOT (it's indexed for inline pairing).
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "assistant"]);
	expect(turns.every((t) => typeof t.id === "string" && t.id.length > 0)).toBe(true);
	// hydrated assistant turns are not streaming.
	expect(
		turns
			.filter((t) => t.kind === "assistant")
			.every((t) => t.kind === "assistant" && !t.streaming),
	).toBe(true);

	// the tool result is keyed by toolCallId (pairs with the assistant turn's toolCall block id).
	expect(toolResults.tc1?.status).toBe("done");
});

test("an assistant turn that ended in a provider error hydrates a following error turn", () => {
	const { turns } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "model 'gpt-5.5' not found",
		},
	] as unknown as Message[]);
	// The failure re-surfaces so a reopened chat shows it, matching the live path.
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "error"]);
	const err = turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("gpt-5.5");
});

test("a failed tool result maps to error status", () => {
	const { toolResults } = messagesToRuntime([
		{
			role: "toolResult",
			toolCallId: "x",
			toolName: "bash",
			content: [],
			isError: true,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(toolResults.x?.status).toBe("error");
});
