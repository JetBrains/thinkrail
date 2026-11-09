import type { McpReadOutputResult, WireModel } from "@thinkrail/contracts";
import type { ToolRevealOptions } from "@thinkrail/extension-api/web";
import { createContext, useContext } from "react";
import type { ResourceTarget } from "./resources";

export type ChatRevealOptions = ToolRevealOptions;

export type ResultTarget = ResourceTarget;

export interface ChatActions {
	cancelAutomaticReveal: () => void;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	respondToTool: (toolCallId: string, response: unknown) => Promise<void>;
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
