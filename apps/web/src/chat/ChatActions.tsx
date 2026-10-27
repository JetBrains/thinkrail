import type { AskUserQuestionResult, McpReadOutputResult, WireModel } from "@thinkrail/contracts";
import { createContext, useContext } from "react";
import type { ResourceTarget } from "./resources";
import type { RevealBlock } from "./scrollGeometry";

export interface ChatRevealOptions {
	block: RevealBlock;
	provenance: "automatic-attention" | "user-navigation";
	runway: "preserve" | "release";
	stability: "none" | "bounded";
	topInset?: number;
}

export type ResultTarget = ResourceTarget;

export interface ChatActions {
	answerQuestion: (toolCallId: string, result: AskUserQuestionResult) => Promise<void>;
	cancelAutomaticReveal: () => void;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	resultOpener: (target: ResultTarget) => (() => void) | undefined;
	markResultSeen?: ((target: ResultTarget) => void) | undefined;
	revealChatElement: (element: HTMLElement, options: ChatRevealOptions) => void;
	readMcpOutput?: ((toolCallId: string) => Promise<McpReadOutputResult>) | undefined;
	openMcpSettings?: (() => void) | undefined;
	openProviderSettings?: (() => void) | undefined;
	findModel?: ((ref: string) => WireModel | null) | undefined;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
