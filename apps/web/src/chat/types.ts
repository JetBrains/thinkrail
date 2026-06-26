import type { AssistantMessage, UserMessage } from "@thinkrail-pi/contracts";

/**
 * A rendered chat turn. User/assistant turns are pi's **canonical** message objects (so these renderers
 * drop into any pi UI); `system` is a web-local notice (e.g. "✓ Done"). Tool results are not turns —
 * they're indexed by `toolCallId` and rendered inline with their call (see `ToolResultState`).
 */
export type ChatTurn =
	| { kind: "user"; id: string; message: UserMessage }
	| { kind: "assistant"; id: string; message: AssistantMessage; streaming: boolean }
	| { kind: "system"; id: string; text: string };

export type ToolStatus = "running" | "done" | "error";

/** A tool's live state keyed by `toolCallId`. `raw` is the pi event's `result`/`partialResult` (typed any). */
export interface ToolResultState {
	status: ToolStatus;
	raw: unknown;
}
