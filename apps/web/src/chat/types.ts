import type { AssistantMessage, ExtUiRequest, UserMessage } from "@thinkrail/contracts";

/** The extension-UI frames that await a browser reply (the ones `ExtUiDialog` renders). */
export type ExtUiDialogRequest = Extract<
	ExtUiRequest,
	{ kind: "select" | "confirm" | "input" | "editor" }
>;

/**
 * A rendered chat turn. User/assistant turns are pi's **canonical** message objects (so these renderers
 * drop into any pi UI); `system` is a web-local notice (e.g. "✓ Done"); `error` is a web-local failure
 * notice (a turn that ended in a provider/model error, or a send the host rejected — e.g. a bad model or a
 * missing API key). A turn-end "✓ Done" marker also carries `endedAt` (the agent_end wall-clock) so the
 * round summary can measure the turn's duration. Tool results are not turns — they're indexed by
 * `toolCallId` and rendered inline with their call (see `ToolResultState`).
 */
export type ChatTurn =
	| { kind: "user"; id: string; message: UserMessage }
	| { kind: "assistant"; id: string; message: AssistantMessage; streaming: boolean }
	| { kind: "system"; id: string; text: string; endedAt?: number }
	/** A failure notice: the run ended in an error, or the host rejected a send. `text` is the reason. */
	| { kind: "error"; id: string; text: string }
	/** A live auto-retry countdown (shown during the back-off, cleared when the retry resolves). */
	| { kind: "retry"; id: string; attempt: number; maxAttempts: number; delayMs: number };

export type ToolStatus = "running" | "done" | "error";

/** A tool's live state keyed by `toolCallId`. `raw` is the pi event's `result`/`partialResult` (typed any). */
export interface ToolResultState {
	status: ToolStatus;
	raw: unknown;
}
