import type { AskUserQuestionResult } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { RevealBlock } from "./scrollGeometry";

export interface ChatRevealOptions {
	block: RevealBlock;
	provenance: "automatic-attention" | "user-navigation";
	runway: "preserve" | "release";
	stability: "none" | "bounded";
	topInset?: number;
}

export interface ChatActions {
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
	cancelAutomaticReveal: () => void;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	revealChatElement: (element: HTMLElement, options: ChatRevealOptions) => void;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
