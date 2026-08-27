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
import type { ImageContent, Message, Model, StopReason, TextContent } from "@earendil-works/pi-ai";

export type WireModel = Pick<
	Model<string>,
	"id" | "name" | "provider" | "contextWindow" | "reasoning"
> & {
	thinkingLevels: ThinkingLevel[];
};

export interface RefreshedModels {
	models: WireModel[];
	complete: boolean;
}

export interface AgentSettlement {
	stopReason: StopReason;
	errorMessage?: string;
}

export type PiEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
	| { type: "agent_settled"; terminal: AgentSettlement | null }
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
			hasImages?: true;
	  }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: CompactionEndResult | undefined;
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
	| { type: "bash_execution_update"; id?: string; delta: string };

export interface CompactionEndResult {
	tokensBefore: number;
	estimatedTokensAfter?: number;
}

export interface SessionEventPayload {
	sessionId: string;
	event: PiEvent;
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface SessionStats {
	sessionId: string;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: ContextUsage;
}

export type QueueLane = "steering" | "followUp";

export interface SessionQueueState {
	steering: readonly string[];
	followUp: readonly string[];
	hasImages?: true;
}

export interface QueuedMessageContent {
	text: string;
	images?: readonly ImageContent[];
}

export interface SessionQueueContent {
	steering: readonly QueuedMessageContent[];
	followUp: readonly QueuedMessageContent[];
}

export interface RemovedQueuedMessage {
	removed: QueuedMessageContent | null;
	queue: SessionQueueState;
}

export interface SessionSummary {
	sessionId: string;
	workspaceId: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	messageCount: number;
	updatedAt: number;
	live: boolean;
	openTodos?: number;
	lastSettlement?: AgentSettlement | null;
	queue?: SessionQueueState;
}

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandSourceInfo {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SlashCommandSourceInfo;
}

export type SkillDecision = "load" | "untrusted" | "pending-ack" | "disabled";

export interface SkillCatalogEntry {
	name: string;
	description?: string;
	sourceInfo: SlashCommandSourceInfo;
	gated: boolean;
	plugin?: string;
	group: string;
	decision: SkillDecision;
}

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
	| { id: string; sessionId: string; kind: "dismiss" };

export interface ExtUiResponse {
	id: string;
	value: string | boolean | null;
}

export interface AskUserQuestionOption {
	label: string;
	description: string;
	preview?: string;
	recommendedReason?: string;
}

export interface AskUserQuestionItem {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect?: boolean;
}

export interface AskUserQuestionArgs {
	questions: AskUserQuestionItem[];
}

export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}

export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}

export interface AskUserQuestionAckDetails {
	kind: "ack";
}

export interface AskUserAnswersDetails {
	toolCallId: string;
	result: AskUserQuestionResult;
}

export interface WireCustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

export interface WireCompactionSummary {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export type TranscriptMessage = Message | WireCustomMessage | WireCompactionSummary;

const TRANSCRIPT_MESSAGE_ROLES: ReadonlySet<string> = new Set([
	"user",
	"assistant",
	"toolResult",
	"custom",
	"compactionSummary",
]);

export function isTranscriptMessageRole(role: string): boolean {
	return TRANSCRIPT_MESSAGE_ROLES.has(role);
}
