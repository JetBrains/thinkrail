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

/**
 * A model **as it crosses the wire**: an **allowlist** of exactly the fields the UI renders — identity
 * (`id`/`name`/`provider`, which also let the host re-resolve the real model) + the picker's display bits
 * (`contextWindow`/`reasoning`). Deliberately a `Pick`, **not** an `Omit`: `Model.baseUrl` carries the
 * jbcentral proxy token (`http://127.0.0.1:<port>/wire/<SECRET>/…`) when JetBrains AI is wired and `headers`
 * can carry auth, and an allowlist **fails closed** — a future `Model` field (secret or not) is excluded by
 * default rather than leaking. The client refers a model back by `{ provider, id }`; the host re-resolves the
 * real `Model` (with `baseUrl`) from its own registry, so a client can neither read the secret nor inject a
 * `baseUrl` for the agent to call. (Widen this set only for a field the UI truly renders — never a
 * credential-bearing one.)
 */
export type WireModel = Pick<
	Model<string>,
	"id" | "name" | "provider" | "contextWindow" | "reasoning"
>;

// The unified render union the UI switches on. The real superset (`AgentSessionEvent`) is declared in the
// Node-only `pi-coding-agent` (it pulls node:fs), so it's MIRRORED here type-only, derived from the
// imported `AgentEvent`. Keep in sync with @earendil-works/pi-coding-agent@0.80.3
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
			// `CompactionResult` lives in the Node-only pi-coding-agent; the UI doesn't read it.
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
// MIRRORED here type-only for the wire. Keep in sync with @earendil-works/pi-coding-agent@0.80.3.

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
	model: WireModel | null;
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

// ---- ask_user_question — structured clarifying questions, rendered INLINE in the chat ----
// The capability is a host-owned pi custom tool (server `agent/askUserQuestion`): the agent calls
// `ask_user_question` with these args; the tool blocks while the browser renders the questionnaire card
// and awaits an `AskUserQuestionResult` (correlated by the tool call's id).

/** One selectable option in a question. */
export interface AskUserQuestionOption {
	/** Short display label (1–5 words). */
	label: string;
	/** What the choice means / its trade-off. */
	description: string;
	/** Optional markdown preview shown beside the option (code, ASCII diagram, config). Single-select only. */
	preview?: string;
	/**
	 * Why the agent recommends this option — revealed behind the Recommended badge's (?) affordance.
	 * Meaningful only on the recommended option; optional + back-compatible (absent → no icon).
	 */
	recommendedReason?: string;
}

/** One question in the questionnaire. */
export interface AskUserQuestionItem {
	/** The full question text (ends with "?"). */
	question: string;
	/** Very short chip/tag shown next to the question (≤16 chars). */
	header: string;
	/** 2–4 mutually-exclusive choices (unless `multiSelect`). */
	options: AskUserQuestionOption[];
	/** Allow several answers. The free-text row is still offered; its text rides along as an extra answer. */
	multiSelect?: boolean;
}

/** The `ask_user_question` tool-call arguments (what the agent authors). 1–4 questions. */
export interface AskUserQuestionArgs {
	questions: AskUserQuestionItem[];
}

/**
 * One answer the browser sends back, tagged by how it was produced:
 * - `option` — picked one author-defined option (`answer` = its label);
 * - `custom` — typed free text via the "Type your own answer" row (`answer` = the text);
 * - `multi`  — committed multi-select choices (`selected` = chosen labels; `answer` = the free text
 *   typed in the "Type your own answer" row as an ADDITIONAL answer, or null when none).
 */
export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	/** Echoed back when the chosen single-select option carried a `preview`. */
	preview?: string;
}

/** The browser's reply to an `ask_user_question` tool call — resolves the awaiting tool `execute`. */
export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}
