import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";

/**
 * The interaction seam for chat tool renderers that need to talk BACK to the agent (e.g. the inline
 * `ask_user_question` card sending its reply). Presentational renderers stay store/transport
 * free — they read these callbacks from context instead. `ChatView` (the app-integration layer) provides
 * the value, wired to the transport + this tab's `sessionId`; when no provider is present (a renderer used
 * standalone, e.g. an extracted `packages/chat-ui`), the context is `null` and the card renders read-only.
 */
export interface ChatActions {
	/**
	 * Answer an awaiting `ask_user_question` questionnaire, correlated by its tool call id — the host
	 * injects the reply as the next turn's `ask-user-answers` message. Rejects when the host refuses it
	 * (unknown session/call, already answered, superseded) so the card can un-latch its "sent" state.
	 */
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

/** The chat actions for the surrounding `ChatView`, or `null` when rendered without one (read-only). */
export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
