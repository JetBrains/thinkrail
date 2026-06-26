// pi protocol types, re-exported TYPE-ONLY from the pi-ai / pi-agent-core roots. `verbatimModuleSyntax`
// erases these at build, so the web bundle never pulls pi runtime. Never value-import a pi package here,
// never import `@earendil-works/pi-coding-agent` (node:fs), and never touch the pi-ai provider subpaths
// (`/providers/*`, `/api/*`, …) — they pull the Node SDKs.

export type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
export type {
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "@earendil-works/pi-ai";

import type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";

// The unified render union the UI switches on. The real superset (`AgentSessionEvent`) is declared in the
// Node-only `pi-coding-agent` (it pulls node:fs), so it's MIRRORED here type-only, derived from the
// imported `AgentEvent`. Keep in sync with @earendil-works/pi-coding-agent@0.80.2
// (core/agent-session.d.ts) — the session-event members below are what `session.subscribe` emits.
export type PiEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
	| { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			// `CompactionResult` lives in the Node-only pi-coding-agent; the UI doesn't read it (M11).
			result: unknown;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| {
			type: "auto_retry_start";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
	  }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/** The `pi.event` push frame: a session's event tagged with its id. */
export interface SessionEventPayload {
	sessionId: string;
	event: PiEvent;
}
