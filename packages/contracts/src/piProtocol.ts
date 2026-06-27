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
import type { Model } from "@earendil-works/pi-ai";

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

// The shapes below are declared in the Node-only `pi-coding-agent` (it pulls node:fs), so they're
// MIRRORED here type-only for the wire. Keep in sync with @earendil-works/pi-coding-agent@0.80.2.

/** Context-window usage for the active model. `tokens`/`percent` are null when unknown (post-compaction). */
export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

/** Per-session token/cost stats — display only; `pi` owns the numbers, the host never recomputes them. */
export interface SessionStats {
	sessionId: string;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: ContextUsage;
}

/**
 * A chat session as the host reports it for hydration — the domain state a client rebuilds its chat tab +
 * runtime from on connect (the transcript is fetched separately via `session.getMessages`).
 */
export interface SessionSummary {
	sessionId: string;
	workspaceId: string;
	title: string;
	model: Model<string> | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	messageCount: number;
	/** Epoch ms of last activity — for ordering (esp. once disk-persisted sessions populate history). */
	updatedAt: number;
	/**
	 * `true` for a session live in the host's memory (auto-restore as an open tab); `false` for one only on
	 * disk (a past session a client surfaces in chat-history and re-opens on demand). `model`/`thinkingLevel`
	 * are placeholders for a disk session until it's opened.
	 */
	live: boolean;
}

export type SlashCommandSource = "extension" | "prompt" | "skill";

/** Where a slash command/skill came from (mirrors pi's `SourceInfo`). */
export interface SlashCommandSourceInfo {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

/** A registered slash command / skill the agent can invoke (the skill catalog, cheap win #2). */
export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SlashCommandSourceInfo;
}

// Extension-UI bridge frames — OUR wire shape for pi's in-process `uiContext` calls. The server pushes an
// `ExtUiRequest` on `pi.extensionUi`; for dialog kinds the browser replies with `ExtUiResponse`
// (correlated by `id`), which resolves the awaiting `uiContext` promise. The fire-and-forget kinds
// (`notify`/`setStatus`/`setWidget`/`setTitle`/`dismiss`) expect no reply.
export type ExtUiRequest =
	| { id: string; sessionId: string; kind: "select"; title: string; options: string[] }
	| { id: string; sessionId: string; kind: "confirm"; title: string; message: string }
	| { id: string; sessionId: string; kind: "input"; title: string; placeholder?: string }
	| { id: string; sessionId: string; kind: "editor"; title: string; prefill?: string }
	| {
			id: string;
			sessionId: string;
			kind: "notify";
			message: string;
			level: "info" | "warning" | "error";
	  }
	| { id: string; sessionId: string; kind: "setStatus"; key: string; text: string | null }
	| { id: string; sessionId: string; kind: "setWidget"; key: string; content: string[] | null }
	| { id: string; sessionId: string; kind: "setTitle"; title: string }
	/** Server-initiated: close an in-flight dialog (the agent aborted / the dialog timed out). */
	| { id: string; sessionId: string; kind: "dismiss" };

/** A dialog reply. `select`/`input`/`editor` → string (null = cancelled); `confirm` → boolean. */
export interface ExtUiResponse {
	id: string;
	value: string | boolean | null;
}
