import type {
	ChatContinuation,
	ChatHandoffDetails,
	ContinueInWorkspaceRequestDetails,
	McpReadOutputResult,
	WireModel,
} from "@thinkrail/contracts";
import { type ComponentType, createContext, useContext } from "react";
import type { ResourceTarget } from "./resources";

export interface ChatRevealOptions {
	block: "start" | "nearest";
	provenance: "automatic-attention" | "user-navigation";
	runway: "preserve" | "release";
	stability: "none" | "bounded";
	topInset?: number;
}

export type ResultTarget = ResourceTarget;

export interface WorkspaceChatTarget {
	workspaceId: string;
	projectId: string;
	sessionId?: string | undefined;
}

export interface ChatActions {
	cancelAutomaticReveal: () => void;
	focusComposer: () => void;
	openSubagentTranscript: (childSessionId: string) => void;
	respondToTool: (toolCallId: string, response: unknown) => Promise<void>;
	resultOpener: (target: ResultTarget) => (() => void) | undefined;
	revealChatElement: (element: HTMLElement, options: ChatRevealOptions) => void;
	readMcpOutput?: ((toolCallId: string) => Promise<McpReadOutputResult>) | undefined;
	openMcpSettings?: (() => void) | undefined;
	openProviderSettings?: (() => void) | undefined;
	findModel?: ((ref: string) => WireModel | null) | undefined;
	/** Continue in workspace: the host-owned phase of an operation, where it went, and how to ask again. */
	continuationOf?: ((operationId: string) => ChatContinuation | undefined) | undefined;
	retryContinuation?: ((details: ContinueInWorkspaceRequestDetails) => void) | undefined;
	openHandoffSource?: ((details: ChatHandoffDetails) => void) | undefined;
	openWorkspace?: ((target: WorkspaceChatTarget) => void) | undefined;
	WorkspaceName?: ComponentType<{ workspaceId: string; fallback: string }> | undefined;
	/** The connected host's protocol version, for renderers that gate on host capabilities. */
	hostProtocol?: number | undefined;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
