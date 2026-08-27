import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";

export interface ChatActions {
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
	sendPrompt: (text: string) => void;
	focusComposer: () => void;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
