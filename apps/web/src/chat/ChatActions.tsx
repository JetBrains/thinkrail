import type { AskUserQuestionResult, DelegationRunStatus } from "@thinkrail/contracts";
import { createContext, useContext } from "react";

export interface ChatActions {
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	probeSubagentStatus: (childSessionId: string) => Promise<DelegationRunStatus | undefined>;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
