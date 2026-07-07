import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";

/**
 * The interaction seam for chat tool renderers that need to talk BACK to the agent (e.g. the inline
 * `ask_user_question` card answering a blocked tool call). Presentational renderers stay store/transport
 * free — they read these callbacks from context instead. `ChatView` (the app-integration layer) provides
 * the value, wired to the transport + this tab's `sessionId`; when no provider is present (a renderer used
 * standalone, e.g. an extracted `packages/chat-ui`), the context is `null` and the card renders read-only.
 */
export interface ChatActions {
	/**
	 * Answer a blocked `ask_user_question` tool call, correlated by its tool call id. Rejects when the host
	 * refuses the reply (unknown session, malformed result) so the card can un-latch its "sent" state.
	 */
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

/** The chat actions for the surrounding `ChatView`, or `null` when rendered without one (read-only). */
export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
