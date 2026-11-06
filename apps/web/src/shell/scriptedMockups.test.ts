import { expect, test } from "bun:test";
import type { ChatTurn, ToolResultState } from "../chat/types";
import { hasDesktopBridge, isVisualizedMockup } from "./scriptedMockups";

const MOCKUP = ".thinkrail/context/mockups/chart.html";

function stateWith(
	args: Record<string, unknown>,
	status: ToolResultState["status"] = "done",
	name = "visualize",
) {
	const turn = {
		kind: "assistant",
		id: "a1",
		streaming: false,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
		},
	} as unknown as ChatTurn;
	return {
		tabsByWorkspace: { ws: [{ kind: "chat", id: "tab-1", sessionId: "s1", name: "Chat" }] },
		closedChatsByWorkspace: {},
		layoutDocumentsByWorkspace: {},
		sessions: { s1: { turns: [turn], toolResults: { "call-1": { status, raw: undefined } } } },
	} as unknown as Parameters<typeof isVisualizedMockup>[0];
}

test("a mockup shown by a finished visualize call in the workspace is trusted", () => {
	expect(isVisualizedMockup(stateWith({ type: "file", path: MOCKUP }), "ws", MOCKUP)).toBe(true);
	const before = ".thinkrail/context/mockups/old.html";
	expect(isVisualizedMockup(stateWith({ type: "file", path: MOCKUP, before }), "ws", before)).toBe(
		true,
	);
});

test("an unshown, failed, foreign-workspace or non-mockup path stays untrusted", () => {
	const shown = stateWith({ type: "file", path: MOCKUP });
	expect(isVisualizedMockup(shown, "ws", ".thinkrail/context/mockups/other.html")).toBe(false);
	expect(isVisualizedMockup(shown, "other-ws", MOCKUP)).toBe(false);
	expect(isVisualizedMockup(stateWith({ path: MOCKUP }, "error"), "ws", MOCKUP)).toBe(false);
	expect(isVisualizedMockup(stateWith({ path: MOCKUP }, "running"), "ws", MOCKUP)).toBe(false);
	expect(isVisualizedMockup(stateWith({ path: MOCKUP }, "done", "write"), "ws", MOCKUP)).toBe(
		false,
	);
	expect(isVisualizedMockup(stateWith({ path: "index.html" }), "ws", "index.html")).toBe(false);
});

test("the desktop bridge is detected from the Electrobun preload global", () => {
	expect(hasDesktopBridge({})).toBe(false);
	expect(hasDesktopBridge({ __electrobun: {} })).toBe(true);
});
