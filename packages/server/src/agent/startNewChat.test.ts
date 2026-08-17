import { afterEach, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StartNewChatDetails } from "@thinkrail/contracts";
import {
	createStartNewChatTool,
	START_NEW_CHAT_TOOL_NAME,
	type StartNewChatRequest,
	setStartNewChatHandler,
} from "./startNewChat";

/** A minimal `ExtensionContext`: the tool reads the session id, the current model, and the effort. */
const ctx = (over: Partial<{ model: unknown; thinkingLevel: string }> = {}): ExtensionContext =>
	({
		sessionManager: { getSessionId: () => "origin-1" },
		model: over.model,
		thinkingLevel: over.thinkingLevel,
	}) as unknown as ExtensionContext;

const run = (params: { title?: string; prompt: string }, context = ctx()) =>
	createStartNewChatTool().execute("tc-1", params as never, undefined, undefined, context);

afterEach(() => {
	// Restore the fail-loud default so test order can't leak a stub handler.
	setStartNewChatHandler(() => {
		throw new Error("Starting new chats is not available on this host.");
	});
});

test("delegates to the host seam with the calling session's identity, model and effort", async () => {
	let seen: StartNewChatRequest | undefined;
	setStartNewChatHandler(async (request) => {
		seen = request;
		return { sessionId: "new-1", title: "Implement X" };
	});
	const result = await run(
		{ title: "Implement X", prompt: "Read the handoff and implement." },
		ctx({
			model: { provider: "anthropic", id: "claude-x", baseUrl: "secret" },
			thinkingLevel: "high",
		}),
	);
	expect(seen).toEqual({
		originSessionId: "origin-1",
		prompt: "Read the handoff and implement.",
		title: "Implement X",
		model: { provider: "anthropic", id: "claude-x" }, // the ref only — never the full Model (baseUrl)
		thinkingLevel: "high",
	});
	expect((result.details as StartNewChatDetails).sessionId).toBe("new-1");
	expect(result.content[0]?.type).toBe("text");
});

test("omits absent title/model/effort rather than passing placeholders", async () => {
	let seen: StartNewChatRequest | undefined;
	setStartNewChatHandler(async (request) => {
		seen = request;
		return { sessionId: "new-2", title: "Chat" };
	});
	await run({ prompt: "Go." });
	expect(seen).toEqual({ originSessionId: "origin-1", prompt: "Go." });
});

test("an empty prompt fails loud before reaching the seam", async () => {
	let called = false;
	setStartNewChatHandler(async () => {
		called = true;
		return { sessionId: "x", title: "x" };
	});
	await expect(run({ prompt: "   " })).rejects.toThrow(/prompt/);
	expect(called).toBe(false);
});

test("a seam rejection (e.g. kickoff not accepted) propagates as the tool's error", async () => {
	setStartNewChatHandler(async () => {
		throw new Error("No API key for model");
	});
	await expect(run({ prompt: "Go." })).rejects.toThrow("No API key for model");
});

test("the default handler fails loud until the host installs the seam", async () => {
	await expect(run({ prompt: "Go." })).rejects.toThrow(/not available/);
});

test("tool name matches the wire/renderer join key", () => {
	expect(createStartNewChatTool().name).toBe(START_NEW_CHAT_TOOL_NAME);
	expect(START_NEW_CHAT_TOOL_NAME).toBe("start_new_chat");
});
