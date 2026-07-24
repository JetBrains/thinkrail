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
import type { ImageContent, Message, Model, TextContent } from "@earendil-works/pi-ai";

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
// imported `AgentEvent`. Keep in sync with @earendil-works/pi-coding-agent@0.82.0
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
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	// Compaction / branch-summary retry lifecycle (pi ≥0.81.1). The UI renders the countdown
	// (`scheduled`) and the all-clear (`finished`); `attempt_start` is delivered but deliberately ignored
	// (by the time an attempt starts, the countdown has drained — nothing new to show).
	| {
			type: "summarization_retry_scheduled";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
	  }
	| { type: "summarization_retry_attempt_start"; source: "branchSummary" }
	| {
			type: "summarization_retry_attempt_start";
			source: "compaction";
			reason: "manual" | "threshold" | "overflow";
	  }
	| { type: "summarization_retry_finished" }
	// Streamed output of `session.executeBash` (pi ≥0.82.0) — mirrored for union fidelity only: this host
	// never calls `executeBash` (terminals are real PTYs), so the UI never receives it and ignores it.
	| { type: "bash_execution_update"; id?: string; delta: string };

/** The `pi.event` push frame: a session's event tagged with its id. */
export interface SessionEventPayload {
	sessionId: string;
	event: PiEvent;
}

// The shapes below are declared in the Node-only `pi-coding-agent` (it pulls node:fs), so they're
// MIRRORED here type-only for the wire. Keep in sync with @earendil-works/pi-coding-agent@0.82.0.

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

/**
 * Why a skill is or isn't loaded — the Skills manager renders all four so a hidden skill is never a silent
 * mystery. `load` = in the agent's context; `untrusted` = a project alias under an untrusted project;
 * `pending-ack` = a project alias that appeared after trust was granted (needs confirming); `disabled` =
 * admissible but toggled off (workspace override, else project baseline).
 */
export type SkillDecision = "load" | "untrusted" | "pending-ack" | "disabled";

/** One skill in the workspace Skills manager: its identity, provenance, and current admission verdict. */
export interface SkillCatalogEntry {
	/** Bare skill name — the key ack / enable-disable / override operations use. */
	name: string;
	description?: string;
	sourceInfo: SlashCommandSourceInfo;
	/** True for a committed project-scoped alias (the trust-gated class). */
	gated: boolean;
	/** The installing Claude plugin's name, when this skill came from one — lets the manager group by plugin. */
	plugin?: string;
	/** Canonical group key the skill toggles under: a plugin name, or `project`/`personal`/`bundled`/`pi`. */
	group: string;
	decision: SkillDecision;
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
// The capability is a host-owned pi custom tool (server `agent/askUserQuestion`), designed "ack +
// terminate": the tool returns an ACK immediately and ends the agent's turn, so nothing blocks and the
// transcript stays valid across host restarts. The browser renders the questionnaire card from the tool
// call's args; the user's reply (`session.answerQuestion`, correlated by the tool call's id) is delivered
// to the session as an `ask-user-answers` custom message that starts the next turn.

/** One selectable option in a question. */
export interface AskUserQuestionOption {
	/** Short display label (1–5 words). */
	label: string;
	/** What the choice means / its trade-off. */
	description: string;
	/** Optional markdown preview shown beside the option (code, ASCII diagram, config). Single-select only. */
	preview?: string;
	/**
	 * Why the agent recommends this option — rendered inline as a `Why:` line under the option's description.
	 * Meaningful only on the recommended option; optional + back-compatible (absent → no rationale shown).
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

/** The browser's reply to an `ask_user_question` tool call. */
export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}

/**
 * The `ask_user_question` tool result's `details` under the ack + terminate design: the call itself
 * resolves instantly with this marker (the turn ends; the model is told answers arrive as the next user
 * message). The card treats an ack'd call with no later answers message as "awaiting" — still answerable,
 * now or after any number of host restarts. Legacy transcripts (the old blocking tool) carry an
 * `AskUserQuestionResult` here instead, which the card still renders as a resolved record.
 */
export interface AskUserQuestionAckDetails {
	kind: "ack";
}

/**
 * `details` of an `ask-user-answers` custom message (its `customType` constant lives in `wsProtocol`,
 * the value-bearing half of this package): the reply, correlated to its tool call. The UI pairs it with
 * the questionnaire card by `toolCallId` and never renders the message as its own bubble.
 */
export interface AskUserAnswersDetails {
	toolCallId: string;
	result: AskUserQuestionResult;
}

/**
 * MIRROR of pi-coding-agent's `CustomMessage` (that package is Node-only, so the shape is re-declared
 * type-only for the wire — keep in sync with @earendil-works/pi-coding-agent@0.82.0 core/messages.d.ts):
 * an extension-injected transcript message (`sendCustomMessage`). Crosses the wire in
 * `session.getMessages` and inside `message_start`/`message_end` events; the LLM sees it as a user
 * message. The web renders only the `customType`s it knows (e.g. `ask-user-answers`) and ignores the rest.
 */
export interface WireCustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

/** A transcript message as `session.getMessages` reports it: pi-canonical + custom messages. */
export type TranscriptMessage = Message | WireCustomMessage;
