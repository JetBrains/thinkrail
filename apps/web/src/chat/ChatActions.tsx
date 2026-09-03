import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { RevealBlock } from "./scrollGeometry";

export interface ChatActions {
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	revealChatElement: (
		element: HTMLElement,
		block?: RevealBlock,
		runway?: "preserve" | "release",
	) => void;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
