import type {
	AssistantMessage,
	BackgroundCommandCompletionDetails,
	ExtUiRequest,
	ImageContent,
	ReviewFixDetails,
	SubagentCompletionDetails,
	UserMessage,
} from "@thinkrail/contracts";
import type { ToolStatus } from "@thinkrail/extension-api/web";
import type { AssistantFailure } from "./assistantFailure";

export interface ChatAttachment {
	name: string;
	content: ImageContent;
}

export type ExtUiDialogRequest = Extract<
	ExtUiRequest,
	{ kind: "select" | "confirm" | "input" | "editor" }
>;

export type FailureRecovery = "try-again";

export type ChatTurn =
	| { kind: "user"; id: string; message: UserMessage; attachmentNames?: string[] }
	| { kind: "assistant"; id: string; message: AssistantMessage; streaming: boolean }
	| { kind: "system"; id: string; text?: string; endedAt?: number }
	| ({ kind: "compaction"; id: string } & CompactionState)
	| {
			kind: "error";
			id: string;
			text: string;
			failure?: AssistantFailure;
			recovery?: FailureRecovery;
	  }
	| {
			kind: "backgroundCommandCompletion";
			id: string;
			details: BackgroundCommandCompletionDetails;
			timestamp: number;
	  }
	| {
			kind: "subagentCompletion";
			id: string;
			details: SubagentCompletionDetails;
			text: string;
			timestamp: number;
	  }
	| { kind: "reviewFix"; id: string; details: ReviewFixDetails; text: string; timestamp: number }
	| {
			kind: "retry";
			id: string;
			source: "turn" | "summarization";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  };

export interface CompactionState {
	status: "running" | "done" | "failed" | "cancelled";
	detail?: string;
	summary?: string;
	tokensBefore?: number;
	tokensAfter?: number;
	resuming?: boolean;
}

export interface ToolResultState {
	status: ToolStatus;
	raw: unknown;
}
