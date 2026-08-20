import type {
	AssistantMessage,
	ExtUiRequest,
	ImageContent,
	UserMessage,
} from "@thinkrail/contracts";

export interface ChatAttachment {
	name: string;
	content: ImageContent;
}

export type ExtUiDialogRequest = Extract<
	ExtUiRequest,
	{ kind: "select" | "confirm" | "input" | "editor" }
>;

export type ChatTurn =
	| { kind: "user"; id: string; message: UserMessage; attachmentNames?: string[] }
	| { kind: "assistant"; id: string; message: AssistantMessage; streaming: boolean }
	| { kind: "system"; id: string; text: string; endedAt?: number }
	| ({ kind: "compaction"; id: string } & CompactionState)
	| { kind: "error"; id: string; text: string }
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

export type ToolStatus = "running" | "done" | "error";

export interface ToolResultState {
	status: ToolStatus;
	raw: unknown;
}
