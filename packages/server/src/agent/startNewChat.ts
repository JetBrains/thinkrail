// The `start_new_chat` capability — a HOST-OWNED pi custom tool registered on every session (like
// `ask_user_question` / `resolve_comment`): the "ok, implement in a new session" handoff. The agent in a
// live chat calls it to spin up a sibling chat in the same workspace with a prepared kickoff prompt; the
// host creates the session (inheriting the caller's model + thinking effort), broadcasts it so every
// client converges, and fires the prompt — the new chat starts working immediately. Execution is
// DELEGATED through a host-installed seam — this module never imports `host` or the workspace registry
// (the agent module has no internal deps by contract). A rejected kickoff (bad model, missing key) is
// the TOOL's failure: pi turns the throw into an error tool result the calling agent relays
// in-conversation — never a silent empty chat.

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { StartNewChatDetails, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

export const START_NEW_CHAT_TOOL_NAME = "start_new_chat";

export const StartNewChatSchema = Type.Object({
	title: Type.Optional(
		Type.String({
			description:
				'Short display name for the new chat\'s tab (3-6 words, e.g. "Implement auth flow").',
		}),
	),
	prompt: Type.String({
		description:
			"The new chat's first message. It must be SELF-CONTAINED — the new session shares the working " +
			"directory but has NO memory of this conversation. For substantial context, first write a handoff " +
			"doc (or point at an existing task spec) under .thinkrail/context/ and reference it here.",
	}),
});

export type StartNewChatParams = Static<typeof StartNewChatSchema>;

const DESCRIPTION = `Start a NEW chat session in this workspace and kick it off with the given prompt. The new chat opens for the user and starts working immediately. Use ONLY when the user explicitly asks to continue or implement something in a new/fresh session or chat. Call it at most once per such request, and never in response to a kickoff prompt you yourself received from this tool. The new session has no memory of this conversation: make the prompt self-contained, preferably by referencing a handoff doc or task spec you wrote under .thinkrail/context/.`;

/** What the tool hands the host seam: the calling session + what the new chat should inherit and run. */
export interface StartNewChatRequest {
	originSessionId: string;
	prompt: string;
	title?: string;
	/** The calling session's current model ref, re-resolved host-side like any inbound ref. */
	model?: Pick<WireModel, "provider" | "id">;
	thinkingLevel?: ThinkingLevel;
}

/** What the seam's handler returns for the tool result. */
export interface StartNewChatOutcome {
	sessionId: string;
	title: string;
}

let handler: (request: StartNewChatRequest) => Promise<StartNewChatOutcome> = () => {
	throw new Error("Starting new chats is not available on this host.");
};

/** Host seam: wire the tool's execution to the host's session-creation compose. */
export function setStartNewChatHandler(
	fn: (request: StartNewChatRequest) => Promise<StartNewChatOutcome>,
): void {
	handler = fn;
}

export function createStartNewChatTool(): ToolDefinition<typeof StartNewChatSchema> {
	return {
		name: START_NEW_CHAT_TOOL_NAME,
		label: "Start New Chat",
		description: DESCRIPTION,
		parameters: StartNewChatSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { title, prompt } = params as StartNewChatParams;
			if (!prompt.trim()) throw new Error("start_new_chat: `prompt` must not be empty.");
			// The calling session's identity + current model/effort come from pi's execution context — the
			// one place a shared (per-loader, pre-session-id) tool registration can learn who called it.
			const outcome = await handler({
				originSessionId: ctx.sessionManager.getSessionId(),
				prompt,
				...(title?.trim() ? { title: title.trim() } : {}),
				...(ctx.model ? { model: { provider: ctx.model.provider, id: ctx.model.id } } : {}),
				...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
			});
			const details: StartNewChatDetails = { sessionId: outcome.sessionId };
			return {
				content: [
					{
						type: "text",
						text: `Started new chat "${outcome.title}" (${outcome.sessionId}) — it is now running the kickoff prompt.`,
					},
				],
				details,
			};
		},
	};
}

/** Extension factory (mirrors `reviewToolExtension`): registers the tool on each session's `pi`. */
export function startNewChatExtension(pi: ExtensionAPI): void {
	pi.registerTool(createStartNewChatTool());
}
