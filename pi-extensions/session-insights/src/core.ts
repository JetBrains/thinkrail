export const SESSION_INSIGHTS_API_VERSION = 10;
export const SESSIONS_LIST_QUERY = "sessions.list";
export const SESSION_SUMMARY_QUERY = "session.summary";
export const SESSION_TRACE_QUERY = "session.trace";
export const EVENT_GET_QUERY = "event.get";
export const TRACE_SEARCH_QUERY = "trace.search";
export const EVENT_ANCHOR_QUERY = "event.anchor";
export const SESSION_TIMELINE_QUERY = "session.timeline";
export const DAY_TIMELINE_QUERY = "day.timeline";
export const SESSION_ANALYSIS_QUERY = "session.analysis";
export const SESSION_SUBAGENTS_QUERY = "session.subagents";
export const SUBAGENT_GET_QUERY = "subagent.get";
export const ERROR_DETAIL_QUERY = "error.detail";
export const SESSION_CONTEXT_QUERY = "session.context";
export const REQUEST_DIFF_QUERY = "request.diff";
export const SESSION_COST_QUERY = "session.cost";
export const SESSION_FILES_QUERY = "session.files";
export const FILE_DETAIL_QUERY = "file.detail";
export const STATS_USAGE_QUERY = "stats.usage";
export const STATS_HOTSPOTS_QUERY = "stats.hotspots";
export const FINDINGS_LIST_QUERY = "findings.list";
export const FINDINGS_HIDE_QUERY = "findings.hide";
export const STATS_SEQUENCES_QUERY = "stats.sequences";
export const SLICES_COMPARE_QUERY = "slices.compare";
export const SESSIONS_ALIGN_QUERY = "sessions.align";
export const SESSIONS_SEARCH_QUERY = "search";
export const LABELS_GET_QUERY = "labels.get";
export const LABELS_SET_QUERY = "labels.set";
export const EXPORT_HTML_QUERY = "export.html";
export const EXPORT_TRACE_QUERY = "export.trace";
export const EXPORT_FIXTURE_QUERY = "export.fixture";
export const FIRST_PROMPT_CHARS = 140;
export const TRACE_LABEL_CHARS = 120;
export const TRACE_PAGE_EVENTS = 2000;
export const TRACE_SEARCH_MAX_IDS = 10_000;
/** Idle stretches at least this long are reported for the trace axis' compression. */
export const TRACE_GAP_MIN_MS = 60_000;
/** A heuristic: a provider's prompt cache stays warm this long after a model reply (the common default TTL). */
export const CACHE_TTL_MS = 5 * 60_000;
/** The timeline packs parallel tool calls onto at most this many tracks, subagents onto this many. */
export const TIMELINE_TOOL_TRACKS = 8;
export const TIMELINE_SUBAGENT_TRACKS = 24;
/** The day view merges a session's tool calls into ticks this wide. */
export const DAY_TICK_MS = 60_000;
/** Heuristic: a retry is the same tool within this many later calls of the same turn. */
export const RETRY_WINDOW_CALLS = 4;
/** Heuristic: a retry shares the path, or at least this share of the words of its main argument. */
export const RETRY_SHARED_WORDS = 0.5;
/** A subagent's activity strip has at most this many ticks. */
export const ACTIVITY_TICKS = 240;
/** Quotes and results in the subagent overview are cut to this many characters. */
export const EXCERPT_CHARS = 320;
/** Prefix of a subagent transcript's event ids when the web nests them in the parent's trace. */
export const CHILD_EVENT_PREFIX = "child:";
/** A request's context by what fills it, in prompt order (estimates scaled to pi's exact total). */
export const CONTEXT_CATEGORIES = [
	"tools",
	"system",
	"skills",
	"summary",
	"user",
	"assistant",
	"results",
	"thinking",
] as const;
/** Heuristic: a file changed (edited or written) this many times in one session is rework. */
export const REWORK_CHANGES = 5;
/** The costliest moments listed before the rest is summed. */
export const COST_MOMENTS = 8;

// ── Other packages' records, read structurally (pinned by host-side tripwire tests) ──

/** pi-subagents' tool that spawns a child run; its result's `details` is a `SubagentRunRecord`. */
export const SUBAGENT_SPAWN_TOOL = "Agent";
/** pi-subagents' tool that waits for a background run; its result's `details` is a `SubagentRunRecord`. */
export const SUBAGENT_RESULT_TOOL = "get_subagent_result";
export const SUBAGENT_TOOLS: readonly string[] = [SUBAGENT_SPAWN_TOOL, SUBAGENT_RESULT_TOOL];
/** The custom message pi-subagents appends when a background run ends (`details`: a `SubagentRunRecord`). */
export const SUBAGENT_COMPLETION_MESSAGE = "subagent-completion";
/** The custom message pi-background-commands appends when a background command ends. */
export const BACKGROUND_COMPLETION_MESSAGE = "background-command-completion";
/** A completion message's `details.delivery` when it woke the idle agent (both packages). */
export const WAKE_DELIVERY = "wake";
/** The `kind` of the `usage` entries that mirror a child's spend into its parent (`note`: the child id). */
export const SUBAGENT_USAGE_KIND = "subagent";
/** Run statuses of a child that has not ended, and of one that ended without success. */
export const UNFINISHED_RUN_STATUSES: readonly string[] = ["queued", "running"];
export const FAILED_RUN_STATUSES: readonly string[] = ["failed", "error", "aborted"];

/** A child run's report: `Agent` / `get_subagent_result` result `details` and completion `details`. */
export interface SubagentRunRecord {
	childSessionId: string;
	status: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}

/** pi-todos' tools, whose calls and results rebuild the plan. */
export const TODO_TOOLS = [
	"todo_write",
	"todo_add",
	"todo_update",
	"todo_promote",
	"todo_remove",
	"todo_list",
	"todo_plan_summary",
] as const;
export const TODO_STATUSES = ["pending", "in_progress", "done"] as const;
/** pi-todos' text fallback, a group line: `▸ Title [status n/m]`. */
export const TODO_TEXT_GROUP = /^▸\s+(.*?)\s+\[[a-z_]+ \d+\/\d+\]\s*$/;
/** pi-todos' text fallback, a step line: `[x] Title — t_…` (glyph, title, id). */
export const TODO_TEXT_ITEM = /\[([ ~x-])\]\s+(.*?)\s+—\s+([tg]_[0-9a-f]+)/;

/** A pi-todos todo as the plan reads it from `details.plan` / `todo` / `paused`. */
export interface TodoRecord {
	id: string;
	title: string;
	status: (typeof TODO_STATUSES)[number];
	origin: "agent" | "user";
}

/** A pi-todos group (`details.plan.groups[]`, `details.group`). */
export interface TodoGroupRecord {
	id: string;
	title: string;
	todos: readonly TodoRecord[];
}

/** A pi-todos plan (`details.plan`). */
export interface TodoPlanRecord {
	todos: readonly TodoRecord[];
	groups: readonly TodoGroupRecord[];
}

export type SessionsListQuery = typeof SESSIONS_LIST_QUERY;
export type SessionSummaryQuery = typeof SESSION_SUMMARY_QUERY;
export type SessionTraceQuery = typeof SESSION_TRACE_QUERY;
export type EventGetQuery = typeof EVENT_GET_QUERY;
export type TraceSearchQuery = typeof TRACE_SEARCH_QUERY;
export type EventAnchorQuery = typeof EVENT_ANCHOR_QUERY;
export type SessionTimelineQuery = typeof SESSION_TIMELINE_QUERY;
export type DayTimelineQuery = typeof DAY_TIMELINE_QUERY;
export type SessionAnalysisQuery = typeof SESSION_ANALYSIS_QUERY;
export type SessionSubagentsQuery = typeof SESSION_SUBAGENTS_QUERY;
export type SubagentGetQuery = typeof SUBAGENT_GET_QUERY;
export type ErrorDetailQuery = typeof ERROR_DETAIL_QUERY;
export type SessionContextQuery = typeof SESSION_CONTEXT_QUERY;
export type RequestDiffQuery = typeof REQUEST_DIFF_QUERY;
export type SessionCostQuery = typeof SESSION_COST_QUERY;
export type SessionFilesQuery = typeof SESSION_FILES_QUERY;
export type FileDetailQuery = typeof FILE_DETAIL_QUERY;
export type StatsUsageQuery = typeof STATS_USAGE_QUERY;
export type StatsHotspotsQuery = typeof STATS_HOTSPOTS_QUERY;
export type FindingsListQuery = typeof FINDINGS_LIST_QUERY;
export type FindingsHideQuery = typeof FINDINGS_HIDE_QUERY;
export type StatsSequencesQuery = typeof STATS_SEQUENCES_QUERY;
export type SlicesCompareQuery = typeof SLICES_COMPARE_QUERY;
export type SessionsAlignQuery = typeof SESSIONS_ALIGN_QUERY;
export type SessionsSearchQuery = typeof SESSIONS_SEARCH_QUERY;
export type LabelsGetQuery = typeof LABELS_GET_QUERY;
export type LabelsSetQuery = typeof LABELS_SET_QUERY;
export type ExportHtmlQuery = typeof EXPORT_HTML_QUERY;
export type ExportTraceQuery = typeof EXPORT_TRACE_QUERY;
export type ExportFixtureQuery = typeof EXPORT_FIXTURE_QUERY;
export type ChildEventPrefix = typeof CHILD_EVENT_PREFIX;
export type SessionInsightsApiVersion = typeof SESSION_INSIGHTS_API_VERSION;
export type TracePageEvents = typeof TRACE_PAGE_EVENTS;

export type Origin =
	| "recorded"
	| "counted"
	| "host"
	| "approximated"
	| "notRecorded"
	| "partiallyRecorded"
	| "notMeasured";

export const BADGED_ORIGINS: readonly Origin[] = [
	"approximated",
	"notRecorded",
	"partiallyRecorded",
	"notMeasured",
];

export interface Figure<T = number> {
	value: T | null;
	origin: Origin;
}

export type MetricId =
	| "start"
	| "wallTime"
	| "activeTime"
	| "tokens"
	| "cost"
	| "subagentsOutside"
	| "toolCalls"
	| "toolErrors"
	| "subagents"
	| "llmCalls"
	| "errors"
	| "turnDuration"
	| "userWait"
	| "waits"
	| "contextTokens"
	| "contextWindow"
	| "cacheMisses"
	| "warmCaches"
	| "plan"
	| "skills"
	| "recovery"
	| "subagentRun"
	| "contextComposition"
	| "cacheShare"
	| "missCause"
	| "callCost"
	| "costMoment"
	| "fileTouches"
	| "fileLines"
	| "fileReceipt"
	| "dailySpend"
	| "toolStats"
	| "toolDuration"
	| "modelLatency"
	| "skillListing"
	| "subagentRoles"
	| "hotspots"
	| "finding"
	| "sequences"
	| "sliceCompare"
	| "alignment";

export const METRIC_SOURCES: Readonly<Record<MetricId, readonly string[]>> = {
	start: ["entry.timestamp", "session.timestamp"],
	wallTime: ["entry.timestamp", "session.timestamp"],
	activeTime: ["entry.timestamp"],
	tokens: [
		"message[assistant].usage",
		"message[toolResult].usage",
		"compaction.usage",
		"branch_summary.usage",
		"usage.usage",
	],
	cost: [
		"message[assistant].usage.cost.total",
		"message[toolResult].usage.cost.total",
		"compaction.usage.cost.total",
		"branch_summary.usage.cost.total",
		"usage.usage.cost.total",
	],
	subagentsOutside: [
		"child transcript usage",
		"message[toolResult:Agent|get_subagent_result].details.usage",
		"custom_message[subagent-completion].details.usage",
		"usage[kind=subagent].usage",
	],
	toolCalls: ["message[assistant].content[toolCall]"],
	toolErrors: ["message[toolResult].isError"],
	subagents: [
		"message[toolResult:Agent|get_subagent_result].details.childSessionId",
		"custom_message[subagent-completion].details.childSessionId",
		"usage[kind=subagent].note",
		"child transcript session.id",
	],
	llmCalls: ["message[assistant]"],
	errors: ["message[toolResult].isError", "message[assistant].stopReason"],
	turnDuration: [
		"entry.timestamp",
		"message[assistant].timestamp",
		"message[assistant].durationMs",
		"message[toolResult].durationMs",
	],
	userWait: [
		"message[assistant].content[toolCall:ask_user_question]",
		"message[toolResult].timestamp",
		"message[toolResult].durationMs",
	],
	waits: [
		"message[assistant].timestamp",
		"message[assistant].durationMs",
		"message[toolResult].durationMs",
		"message[user].timestamp",
		"custom_message[background-command-completion|subagent-completion]",
	],
	contextTokens: [
		"message[assistant].usage.input",
		"message[assistant].usage.cacheRead",
		"message[assistant].usage.cacheWrite",
	],
	contextWindow: ["host model catalog: contextWindow", "message[assistant].usage"],
	cacheMisses: [
		"message[assistant].usage.cacheRead",
		"message[assistant].usage.input",
		"message[assistant].usage.cacheWrite",
	],
	warmCaches: ["message[assistant].timestamp", "message[assistant].durationMs"],
	plan: [
		"message[assistant].content[toolCall:todo_*].arguments",
		"message[toolResult:todo_*].details.plan|todo|group|paused",
		"message[toolResult:todo_*].content",
	],
	skills: [
		"message[assistant].content[toolCall:read].arguments.path (…/SKILL.md)",
		"message[toolResult:read].isError",
		"message[user].content (/skill:name)",
	],
	recovery: [
		"message[toolResult].isError",
		"message[assistant].content[toolCall].arguments",
		"message[assistant].stopReason",
		"message[assistant].errorMessage",
	],
	subagentRun: [
		"message[assistant].content[toolCall:Agent].arguments",
		"message[toolResult:Agent|get_subagent_result].details",
		"custom_message[subagent-completion].details",
		"child transcript",
	],
	contextComposition: [
		"message[system].sections|content|toolsAdded|toolsRemoved",
		"compaction.summary|firstKeptEntryId|systemMessage",
		"context_edit.targetId|replacement",
		"message[user|toolResult].content",
		"message[assistant].content|usage.output|usage.reasoning",
		"custom_message.content",
		"branch_summary.summary",
		"message[assistant].usage.input|cacheRead|cacheWrite",
	],
	cacheShare: [
		"message[assistant].usage.cacheRead",
		"message[assistant].usage.cacheWrite",
		"message[assistant].usage.input",
	],
	missCause: [
		"model_change",
		"message[assistant].provider|model",
		"message[system].sections|toolsAdded|toolsRemoved",
		"compaction",
		"context_edit",
		"thinking_level_change",
		"message[assistant].timestamp|durationMs",
	],
	callCost: ["message[assistant].usage.cost.total", "message[assistant].usage"],
	costMoment: [
		"message[assistant].usage",
		"message[toolResult:todo_*].details",
		"message[user]",
		"compaction",
	],
	fileTouches: [
		"message[assistant].content[toolCall:read|edit|write].arguments.path",
		"message[toolResult:read|edit|write].isError",
	],
	fileLines: [
		"message[toolResult:edit].details.patch|diff",
		"message[assistant].content[toolCall:write].arguments.content",
	],
	fileReceipt: ["host turn receipts: changes[].added|removed"],
	dailySpend: [
		"entry.timestamp",
		"message[assistant].provider|model|responseModel",
		"message[assistant].usage",
		"usage[kind].usage",
		"compaction.usage",
		"branch_summary.usage",
	],
	toolStats: [
		"message[assistant].content[toolCall].name|arguments.command",
		"message[toolResult].isError",
		"message[toolResult].content (bash exit code)",
	],
	toolDuration: ["message[toolResult].durationMs"],
	modelLatency: ["message[assistant].durationMs"],
	skillListing: [
		"message[system].sections.skills (<available_skills>)",
		"compaction.systemMessage.sections.skills",
	],
	subagentRoles: [
		"message[assistant].content[toolCall:Agent].arguments.subagent_type",
		"message[toolResult:Agent|get_subagent_result].details.status|usage",
	],
	hotspots: [
		"message[assistant].content[toolCall:read|edit|write].arguments.path",
		"message[toolResult:read|edit|write].isError",
		"message[toolResult:edit].details.patch|diff",
		"session.cwd",
	],
	finding: [
		"message[toolResult].isError|content",
		"message[assistant].content|stopReason|errorMessage|usage",
		"message[user].content",
		"message[system].sections.skills",
	],
	sequences: ["message[assistant].content[toolCall].name|arguments", "message[toolResult].isError"],
	sliceCompare: [
		"message[assistant].provider|model|usage",
		"message[toolResult].isError",
		"message[user]",
		"entry.timestamp",
		"session.cwd",
	],
	alignment: [
		"message[assistant].content[toolCall].name|arguments",
		"message[toolResult].isError",
		"message[user].content",
	],
};

export interface TokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export type SessionsListScope = { kind: "project"; projectId: string } | { kind: "all" };

export interface SessionsListParams {
	scope: SessionsListScope;
	/** Revalidate the index now rather than within `revalidateMs` (the panel's mount and Refresh). */
	fresh?: boolean;
}

export interface IndexState {
	phase: "cold" | "refreshing" | "ready";
	indexed: number;
	total: number | null;
}

export type SessionOutcome = "succeeded" | "failed" | "interrupted" | "cancelled";

export interface ListProject {
	id: string;
	name: string;
	kind: "repository" | "chats";
}

export interface SessionListRow {
	sessionId: string;
	projectId: string | null;
	workspaceId: string | null;
	workspaceName: string | null;
	workspaceState: "open" | "removed" | "none";
	title: string | null;
	firstPrompt: string | null;
	live: boolean;
	outcome: SessionOutcome | null;
	start: Figure;
	activeMs: Figure;
	tokens: Figure<TokenTotals>;
	cost: Figure;
	subagentsOutside: Figure<{ cost: number; tokens: number }>;
	toolCalls: Figure;
	toolErrors: Figure;
	subagents: Figure;
	models: readonly string[];
}

export interface SessionsListResult {
	apiVersion: number;
	state: IndexState;
	projects: readonly ListProject[];
	rows: readonly SessionListRow[];
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface SessionParams {
	sessionId: string;
}

export interface SessionOverview extends SessionListRow {
	projectName: string | null;
	wallMs: Figure;
}

export interface SessionSummaryResult {
	apiVersion: number;
	state: IndexState;
	/** `null`: no indexed session has this id, or the host hides it. */
	session: SessionOverview | null;
	/**
	 * No indexed session has this id yet while the index is still being built (`state.phase` is not
	 * `ready`): ask again rather than read `null` as gone.
	 */
	pending: boolean;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

/** `recorded`: pi's `durationMs`; `approximated`: from timestamps; `notMeasured`: a point in time. */
export type TimingOrigin = "recorded" | "approximated" | "notMeasured";

export type TraceEventKind = "turn" | "llm" | "tool" | "subagent" | "mark";

export type ToolFamily =
	| "discovery"
	| "reading"
	| "writing"
	| "execution"
	| "planning"
	| "subagent"
	| "ask"
	| "other";

export type MarkKind =
	| "compaction"
	| "modelChange"
	| "thinkingLevel"
	| "sessionInfo"
	| "label"
	| "branchSummary"
	| "customMessage"
	| "system";

export type ThinkingKind = "none" | "plain" | "encrypted";

interface TraceEventBase {
	id: string;
	parent: string | null;
	depth: number;
	t0: number;
	t1: number;
	timing: TimingOrigin;
	/** A one-line, redacted excerpt: the prompt, the reply's first line, a tool's main argument. */
	label: string;
	error?: true;
}

/**
 * What started a turn: the user's prompt, or a background command's or subagent's completion message
 * that woke the idle agent (pi-subagents / pi-background-commands `details.delivery: "wake"`, else
 * inferred from the agent being idle when it arrived).
 */
export type TurnTrigger = "prompt" | "background" | "subagent";

export interface TurnEvent extends TraceEventBase {
	kind: "turn";
	n: number;
	trigger: TurnTrigger;
	chars: number;
}

export interface LlmEvent extends TraceEventBase {
	kind: "llm";
	model: string | null;
	stop: string | null;
	tokens: TokenTotals;
	cost: number;
	replyChars: number;
	thinking: ThinkingKind;
	calls: number;
}

export interface ToolEvent extends TraceEventBase {
	kind: "tool";
	tool: string;
	family: ToolFamily;
	toolCallId: string;
	argsChars: number;
	/** `null` when the call has no result in the file. */
	resultChars: number | null;
	missing?: true;
	/** Bash: the normalized command head (`git diff`, `bun test`). */
	head?: string;
	/** Bash: the exit code from the result trailer, `timeout` / `aborted`, or `error`. */
	exit?: string;
}

/** `label` is the task's title: its first paragraph that no other task of the session opens with. */
export interface SubagentEvent extends TraceEventBase {
	kind: "subagent";
	childId: string;
	role: string | null;
	status: string | null;
	background?: true;
	tokens: number | null;
	cost: number | null;
	/** The parent's first model call after the subagent's result arrived: where it read the result. */
	consumedBy?: string;
}

export interface MarkEvent extends TraceEventBase {
	kind: "mark";
	mark: MarkKind;
	/** The new model or thinking level, or a custom message's type. */
	detail: string | null;
	tokensBefore?: number;
}

export type TraceEvent = TurnEvent | LlmEvent | ToolEvent | SubagentEvent | MarkEvent;

export type GapCause = "user" | "background" | "idle";

/** An idle stretch: nothing ran. `cause` is inferred from what ended it (a prompt, a completion message). */
export interface TraceGap {
	t0: number;
	t1: number;
	cause: GapCause;
}

export interface TraceMeta {
	/** Changes when the session file changes; a client restarts paging on a new revision. */
	revision: string;
	total: number;
	start: number | null;
	end: number | null;
	errors: number;
	gaps: readonly TraceGap[];
	/** Entries on abandoned branches, not shown. */
	offBranch: number;
}

export interface SessionTraceParams {
	sessionId: string;
	/** A subagent of the session: page its transcript instead. */
	childId?: string;
	cursor?: number;
	limit?: number;
	/**
	 * The `meta.revision` of the first page: later pages come from that snapshot while the host retains
	 * it (else from the current revision, which then differs).
	 */
	revision?: string;
}

export interface SessionTraceResult {
	apiVersion: number;
	found: boolean;
	/** Not found yet while the index is still being built: ask again rather than read it as gone. */
	pending: boolean;
	meta: TraceMeta | null;
	cursor: number;
	/** The next page's cursor, `null` after the last page. */
	next: number | null;
	events: readonly TraceEvent[];
	/** The page is from the pinned revision and the file has a newer one: reload after paging. */
	newerRevision: boolean;
}

export interface EventGetParams {
	sessionId: string;
	eventId: string;
	/** The event is in this subagent's transcript. */
	childId?: string;
}

/** Text cut to a cap after redaction; `chars` is the original length, `cut` marks the omitted part. */
export interface CappedText {
	text: string;
	chars: number;
	cut?: { at: number; chars: number; lines: number };
}

/** `[path, original size]`: a string cut to the cap or an array cut to 300 items. */
export type JsonCut = readonly [string, number];

export interface CappedJson {
	value: unknown;
	cuts: readonly JsonCut[];
}

export interface CallUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** The request's context: `input + cacheRead + cacheWrite`. */
	context: number;
	reasoning: number | null;
	cost: number;
}

export interface IssuedCall {
	toolCallId: string;
	name: string;
	eventId: string;
}

/** Where *Open in chat* lands: a host display-projection message, optionally a tool call inside it. */
export interface ChatAnchor {
	messageIndex: number;
	anchorText: string;
	toolCallId?: string;
	/** The target is not shown in the chat; this is its nearest shown ancestor. */
	approximate?: true;
}

export interface EventBody {
	kind: TraceEventKind;
	prompt?: CappedText;
	images?: number;
	reply?: CappedText;
	thinking?: CappedText;
	/** Thinking blocks with a provider signature and no text. */
	encryptedThinking?: number;
	issued?: readonly IssuedCall[];
	usage?: CallUsage;
	model?: string | null;
	stop?: string | null;
	requestedAt?: number | null;
	error?: CappedText;
	tool?: string;
	toolCallId?: string;
	input?: CappedJson;
	result?: CappedText;
	details?: CappedJson;
	resultImages?: number;
	task?: CappedText;
	text?: CappedText;
	/** The pi entries behind the event, redacted, every string capped. */
	raw: readonly CappedJson[];
}

export interface EventGetResult {
	apiVersion: number;
	found: boolean;
	body: EventBody | null;
}

export interface EventAnchorResult {
	apiVersion: number;
	found: boolean;
	/** `null`: the session is not a chat the host can show, or no shown message leads to the event. */
	anchor: ChatAnchor | null;
}

export interface TraceSearchParams {
	sessionId: string;
	query: string;
}

export interface TraceSearchResult {
	apiVersion: number;
	found: boolean;
	revision: string | null;
	/** Matching event ids in trace order. */
	ids: readonly string[];
	truncated: boolean;
}

/**
 * Who the session is waiting on at a moment (a labelled inference): the user (an open
 * `ask_user_question`, or the next prompt), the model, a tool, a subagent, background work, or nobody.
 */
export type WaitActor = "user" | "model" | "tool" | "subagent" | "background" | "idle";

export interface WaitBand {
	t0: number;
	t1: number;
	actor: WaitActor;
}

/** One turn's card: what started it and what it did, every figure with its origin. */
export interface TurnSummary {
	/** The turn event's id in the trace. */
	id: string;
	n: number;
	trigger: TurnTrigger;
	t0: number;
	t1: number;
	duration: Figure;
	/** Time inside the turn the agent waited for the user (open `ask_user_question` calls). */
	userWait: Figure;
	llmCalls: Figure;
	toolCalls: Figure;
	errors: Figure;
	subagents: Figure;
	tokens: Figure<TokenTotals>;
	cost: Figure;
}

export interface LaneTrack {
	id: string;
	track: number;
}

export interface TimelineLanes {
	toolTracks: number;
	subagentTracks: number;
	/** Tool and subagent events packed onto a track other than the first; any other sits on track 0. */
	tracks: readonly LaneTrack[];
}

/** A model call's request context: input + cache read + cache write tokens, as pi recorded them. */
export interface ContextPoint {
	id: string;
	tokens: number;
	/** A heuristic cache miss: the call read under half of the smaller of its and the previous context from cache. */
	miss?: true;
}

/**
 * A model's context window: the host's (`origin: "host"`), or the largest context this session observed
 * when the host knows none or a smaller one (`origin: "approximated"`).
 */
export interface ContextLimit {
	model: string;
	value: number;
	origin: "host" | "approximated";
	host: number | null;
	observed: number;
}

/** Cumulative recorded spend up to `t`. */
export interface SpendPoint {
	t: number;
	tokens: number;
	cost: number;
}

export interface SessionTimeline {
	/** The trace revision this timeline reflects. */
	revision: string;
	start: number | null;
	end: number | null;
	/** Tokens where every recorded cost is $0, else cost. */
	headline: "cost" | "tokens";
	turns: readonly TurnSummary[];
	bands: readonly WaitBand[];
	waits: Readonly<Record<WaitActor, number>>;
	/** Every band's time summed (the who-blocks total). */
	waitsTotal: Figure;
	lanes: TimelineLanes;
	context: readonly ContextPoint[];
	/** The largest request context of any model call. */
	peak: Figure;
	/** Model calls on the active branch. */
	llmCalls: Figure;
	limits: readonly ContextLimit[];
	/** pi's recorded spend over time, every branch; its last point is the session's headline total. */
	spend: readonly SpendPoint[];
	/** The same plus subagent spend outside pi's total, at each subagent's end; `null` when there is none. */
	withSubagents: readonly SpendPoint[] | null;
	cacheTtlMs: number;
}

export interface SessionTimelineResult {
	apiVersion: number;
	found: boolean;
	timeline: SessionTimeline | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface DayTimelineParams {
	scope: SessionsListScope;
	/** `YYYY-MM-DD` in the host's local time zone; omitted, the latest day with a session in scope. */
	day?: string;
}

export interface Interval {
	t0: number;
	t1: number;
}

/** An hour boundary of the day and its local hour (DST days have 23 or 25 hours). */
export interface DayHour {
	t: number;
	hour: number;
}

export interface DayTurn {
	id: string;
	n: number;
	trigger: TurnTrigger;
	t0: number;
	t1: number;
}

/** The tool calls a session started inside one `DAY_TICK_MS` slot, coloured by the most frequent family. */
export interface DayTick {
	t: number;
	family: ToolFamily;
	n: number;
	errors: number;
}

export interface DaySession {
	sessionId: string;
	title: string | null;
	firstPrompt: string | null;
	projectId: string | null;
	workspaceName: string | null;
	live: boolean;
	start: number;
	end: number;
	/** The session ran on past the day's end. */
	continues: boolean;
	turns: readonly DayTurn[];
	ticks: readonly DayTick[];
	/** Heuristic: up to `cacheTtlMs` after each model reply, merged. */
	warm: readonly Interval[];
	misses: readonly number[];
	/** The agent waited on the user's answer to `ask_user_question`. */
	userWaits: readonly Interval[];
	cacheMisses: Figure;
	llmCalls: Figure;
	toolCalls: Figure;
	toolErrors: Figure;
	tokens: Figure<TokenTotals>;
	cost: Figure;
	subagents: Figure;
}

export interface DayTotals {
	llmCalls: Figure;
	toolCalls: Figure;
	toolErrors: Figure;
	tokens: Figure<TokenTotals>;
	cost: Figure;
	cacheMisses: Figure;
}

export interface DayTimelineResult {
	apiVersion: number;
	state: IndexState;
	/** The day shown, `null` when no session in scope has a start time. */
	day: string | null;
	/** Every day with a session start in scope, oldest first. */
	days: readonly string[];
	/** The host's IANA time zone the days are cut in. */
	timeZone: string;
	start: number | null;
	end: number | null;
	hours: readonly DayHour[];
	/** Whole hours with no turn of any row, merged; the strip compresses them. */
	gaps: readonly Interval[];
	/** How many sessions' caches are warm, as a step function from each `t` on. */
	warmCount: readonly { t: number; count: number }[];
	totals: DayTotals | null;
	cacheTtlMs: number;
	sessions: readonly DaySession[];
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Todo plan and skills (bands on the shared axis) ──

export type PlanStatus = "pending" | "inProgress" | "done" | "removed" | "promoted";

export interface PlanChange {
	t: number;
	status: PlanStatus;
	/** The `todo_*` tool call that recorded it. */
	eventId: string;
	tool: string;
	/**
	 * First seen in a `todo_list` read, not set by a call: an edit the user made in the TODO panel (those
	 * are not in the session file) or a change the session missed. Its real time is unknown.
	 */
	snapshot?: true;
}

export interface PlanStep {
	id: string;
	title: string;
	group: string | null;
	origin: "agent" | "user" | null;
	/** When the step first appeared. */
	first: number;
	changes: readonly PlanChange[];
	/** Stretches it was in progress; an open one ends at the trace's end. */
	active: readonly Interval[];
	status: PlanStatus;
	/** Every change came from `todo_list` reads, so its timing is unknown. */
	listedOnly?: true;
	/** Calls, failures and recorded spend while the step was the one in progress. */
	toolCalls: Figure;
	errors: Figure;
	tokens: Figure<TokenTotals>;
	cost: Figure;
}

export interface PlanNote {
	t: number;
	eventId: string;
	text: string;
}

export interface SessionPlan {
	steps: readonly PlanStep[];
	groups: readonly { id: string; title: string }[];
	summaries: readonly PlanNote[];
	/** `todo_*` calls that changed or read the plan. */
	calls: number;
	/** `todo_write` calls that replaced the plan after its first write. */
	rewrites: number;
}

/** A labelled heuristic: a skill applies from its activation to the turn's end or the next activation. */
export type SkillScopeEnd = "nextSkill" | "turnEnd" | "sessionEnd";

export interface SkillActivation {
	name: string;
	t: number;
	eventId: string;
	/** A successful `read` of its `SKILL.md`, or a `/skill:name` prompt. */
	via: "read" | "prompt";
	/** A skill that shapes the session (routing, planning, shipping), by name. */
	workflow: boolean;
	scopeEnd: number;
	scopeBy: SkillScopeEnd;
}

export interface TurnBadges {
	turnId: string;
	/** Plan steps the turn worked on or changed. */
	steps: number;
	/** Steps it finished. */
	done: number;
	skills: readonly string[];
}

// ── Errors and repeats ──

/** Two or more consecutive calls with the same tool and identical arguments. */
export interface RepeatGroup {
	ids: readonly string[];
	tool: string;
	label: string;
	errors: number;
}

/**
 * A tool chain: a failure and its retries (a heuristic — the same tool within `RETRY_WINDOW_CALLS` later
 * calls of the same turn, with the same path or `RETRY_SHARED_WORDS` of the main argument's words).
 * A model chain: consecutive failed model calls up to the next successful one.
 */
export type ChainOutcome =
	| "recovered"
	| "gaveUp"
	| "changedApproach"
	| "sameModel"
	| "afterSwitch"
	| "never";

export interface RecoveryChain {
	index: number;
	kind: "tool" | "model";
	/** The tool, or the failing model. */
	name: string | null;
	/** In order; a model chain ends with the call that recovered, when there is one. */
	attempts: readonly string[];
	/** Calls issued between consecutive attempts (at most 8 per gap), one list per gap. */
	between: readonly (readonly string[])[];
	outcome: ChainOutcome;
	t0: number;
	t1: number;
	/** From the first failure's end to the recovering call's end. */
	recoveredIn: Figure;
	cluster: number | null;
	turnId: string | null;
	/** The first failure's error line, redacted. */
	line: string;
	/** Model chains: how often the model changed along the chain, and prompts it took. */
	switches: number;
	prompts: number;
}

/** Failures grouped by tool and their normalized first error line (a heuristic). */
export interface ErrorCluster {
	index: number;
	kind: "tool" | "model";
	key: string;
	sample: string;
	ids: readonly string[];
	tools: readonly { tool: string; n: number }[];
}

export interface ToolRecovery {
	tool: string;
	failures: number;
	chains: number;
	recovered: number;
	changedApproach: number;
	gaveUp: number;
}

export interface ModelRecovery {
	failures: number;
	chains: number;
	sameModel: number;
	afterSwitch: number;
	never: number;
}

export interface SessionAnalysis {
	revision: string;
	plan: SessionPlan | null;
	skills: readonly SkillActivation[];
	turns: readonly TurnBadges[];
	repeats: readonly RepeatGroup[];
	chains: readonly RecoveryChain[];
	clusters: readonly ErrorCluster[];
	toolRecovery: readonly ToolRecovery[];
	/** Failed tool calls (the recovery table's failures summed). */
	toolFailures: number;
	modelRecovery: ModelRecovery;
	/** Subagents of the session with a transcript the trace can expand. */
	transcripts: readonly string[];
}

export interface SessionAnalysisResult {
	apiVersion: number;
	found: boolean;
	analysis: SessionAnalysis | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface ErrorDetailParams {
	sessionId: string;
	chain: number;
}

export type DiffOp = "same" | "removed" | "added";

export interface DiffSegment {
	op: DiffOp;
	text: string;
}

export interface ChainStep {
	eventId: string;
	tool: string;
	label: string;
	failed: boolean;
	/** An `edit` or `write`: a change made between attempts. */
	edit: boolean;
}

export interface ChainAttempt {
	eventId: string;
	t0: number;
	t1: number;
	failed: boolean;
	exit: string | null;
	model: string | null;
	/** The tool's main argument (command, query, pattern, url, path) or its arguments as JSON. */
	argument: CappedText | null;
	/** Word-level difference from the previous attempt's argument. */
	diff: readonly DiffSegment[] | null;
	error: CappedText | null;
	/** Calls issued after the previous attempt and before this one. */
	between: readonly ChainStep[];
}

export interface ErrorDetail {
	chain: RecoveryChain;
	attempts: readonly ChainAttempt[];
	cluster: ErrorCluster | null;
}

export interface ErrorDetailResult {
	apiVersion: number;
	found: boolean;
	detail: ErrorDetail | null;
}

// ── Subagent waves ──

export type SubagentTranscript = "available" | "missing" | "removed";

/** The parent's words before the spawn: a quote, not an inference. */
export type RationaleSource = "text" | "thinking" | "previous";

export type ResultVia = typeof SUBAGENT_SPAWN_TOOL | typeof SUBAGENT_RESULT_TOOL | "completion";

export interface SubagentQuote {
	text: string;
	chars: number;
	source: RationaleSource;
	/** The parent model call quoted. */
	eventId: string;
}

export interface SubagentReturn {
	text: string;
	chars: number;
	via: ResultVia;
	status: string | null;
	/** The trace event that delivered it. */
	eventId: string;
	at: number;
}

/** `[ms after the run's start, duration ms, family index (-1: a model call), 1 when it failed]`. */
export type ActivityTick = readonly [number, number, number, 0 | 1];

export interface SubagentActivity {
	t0: number;
	t1: number;
	families: readonly ToolFamily[];
	ticks: readonly ActivityTick[];
	llmCalls: number;
	toolCalls: number;
	errors: number;
	model: string | null;
}

export interface SubagentRun {
	childId: string;
	/** The subagent's event in the parent trace. */
	eventId: string;
	/** The `Agent` call that spawned it. */
	spawnEventId: string;
	role: string | null;
	title: string;
	status: string | null;
	background: boolean;
	/** The child's model: its transcript's first model call, else what its reports name. */
	model: string | null;
	spawnAt: number;
	t0: number;
	t1: number;
	duration: Figure;
	tokens: Figure;
	cost: Figure;
	wave: number;
	/** Its track inside the wave (greedy packing by start). */
	lane: number;
	rationale: SubagentQuote | null;
	result: SubagentReturn | null;
	consumedBy: string | null;
	consumedAt: number | null;
	/** From the result's arrival (or the run's end) to the parent's read, never negative; `null` unread. */
	readDelayMs: number | null;
	transcript: SubagentTranscript;
	activity: SubagentActivity | null;
}

/** Spawns inside one turn whose runs overlap. */
export interface SpawnWave {
	n: number;
	turnId: string | null;
	turnN: number | null;
	t0: number;
	t1: number;
	lanes: number;
	childIds: readonly string[];
	/** The first spawn's rationale. */
	rationale: SubagentQuote | null;
	tokens: Figure;
	cost: Figure;
}

export interface SubagentsOverview {
	roles: readonly { role: string | null; n: number }[];
	maxParallel: number;
	tokens: Figure;
	cost: Figure;
	failed: number;
	withErrors: number;
	unmeasured: number;
}

export interface SessionSubagents {
	revision: string;
	waves: readonly SpawnWave[];
	runs: readonly SubagentRun[];
	overview: SubagentsOverview;
}

export interface SessionSubagentsResult {
	apiVersion: number;
	found: boolean;
	subagents: SessionSubagents | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface SubagentGetParams {
	sessionId: string;
	childId: string;
}

export interface SubagentFailure {
	/** The event id inside the subagent's transcript. */
	eventId: string;
	tool: string | null;
	line: string;
}

export interface SubagentDetail {
	run: SubagentRun;
	task: CappedText | null;
	rationale: CappedText | null;
	result: CappedText | null;
	tools: readonly { tool: string; family: ToolFamily; calls: number; errors: number }[];
	failures: readonly SubagentFailure[];
	skills: readonly string[];
	siblings: readonly Pick<SubagentRun, "childId" | "role" | "title" | "status" | "t0" | "t1">[];
}

export interface SubagentGetResult {
	apiVersion: number;
	found: boolean;
	detail: SubagentDetail | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Context and cache ──

export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

/**
 * What changed between two model calls that can explain a cache miss (a labelled heuristic): the
 * model, a `model_change` re-selecting the same model, the system prompt's sections, the tool set, a
 * compaction or context edit rewriting history, the thinking level, or a pause over `CACHE_TTL_MS`.
 */
export type MissCause =
	| "modelChange"
	| "modelReselected"
	| "systemPrompt"
	| "tools"
	| "compaction"
	| "contextEdit"
	| "thinkingLevel"
	| "pause";

export interface ContextMiss {
	/** Empty: no cause is visible in the session file. */
	causes: readonly MissCause[];
}

export interface ContextCall {
	/** The model call's trace event. */
	id: string;
	/** Its number among the session's model calls on the active branch, from 1. */
	n: number;
	t: number;
	model: string | null;
	/** The turn it belongs to. */
	turn: number | null;
	/** Exact: `input + cacheRead + cacheWrite` as pi recorded them. */
	total: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	/** Estimated tokens per `CONTEXT_CATEGORIES`, scaled to `total`: integers that sum to it (all 0 when nothing was estimated). */
	parts: readonly number[];
	/** Each part minus the previous counted call's: what grew or shrank since it (`null` for the first). */
	delta: readonly number[] | null;
	/** The estimate before scaling over the exact total. */
	coverage: number;
	/**
	 * No system message was persisted before the call (older sessions): the system prompt and tools are
	 * not measurable, so the remainder of the exact total is shown as `system` (an inference).
	 */
	unpersisted?: true;
	/** From the previous counted call's end to this call's start. */
	gapMs: number | null;
	/** What changed since the previous call that can break a cache (present when something did). */
	changes?: readonly MissCause[];
	miss?: ContextMiss;
	cost: number;
}

/** A compaction between two calls: the context before it and right after it. */
export interface CompactionCliff {
	id: string;
	t: number;
	/** pi's `tokensBefore`. */
	tokensBefore: number | null;
	before: string | null;
	after: string | null;
	/** The exact contexts of those two calls and the relative change between them. */
	beforeTokens: number | null;
	afterTokens: number | null;
	change: number | null;
}

/** The first call answered by another model than the call before it. */
export interface ModelSwitch {
	at: string;
	from: string | null;
	to: string | null;
}

export interface SessionContext {
	revision: string;
	calls: readonly ContextCall[];
	compactions: readonly CompactionCliff[];
	switches: readonly ModelSwitch[];
	limits: readonly ContextLimit[];
	peak: Figure;
	average: Figure;
	/** Cache reads over all request tokens. */
	cacheShare: Figure;
	misses: Figure;
	/** Tokens written to the cache by the missed calls. */
	rewritten: Figure;
	cacheTtlMs: number;
}

export interface SessionContextResult {
	apiVersion: number;
	found: boolean;
	context: SessionContext | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface RequestDiffParams {
	sessionId: string;
	/** A model call's trace event id. */
	callId: string;
}

export type RequestRole =
	| "user"
	| "assistant"
	| "toolResult"
	| "custom"
	| "bashExecution"
	| "compactionSummary"
	| "branchSummary"
	| "other";

export interface RequestMessage {
	/** 1-based position in the request (system messages excluded). */
	index: number;
	role: RequestRole;
	/** One redacted line: the text's start, a tool's name and argument. */
	label: string;
	chars: number;
	/** `changed`: the same entry's content differs (a context edit); `removed`: only the previous had it. */
	state: "same" | "new" | "changed" | "removed";
	/** The trace event of the message's entry, when the trace shows it. */
	eventId: string | null;
}

export interface SectionDiff {
	name: string;
	before: number | null;
	after: number | null;
	status: "same" | "changed" | "added" | "removed";
	/** Character-level: the common start and end around what changed, each cut. */
	diff?: readonly DiffSegment[];
}

export interface ToolSetDiff {
	before: { count: number; chars: number };
	after: { count: number; chars: number };
	added: readonly string[];
	removed: readonly string[];
	/** Declared again with another definition. */
	changed: readonly string[];
}

export interface RequestSide {
	callId: string;
	n: number;
	t: number;
	model: string | null;
	turn: number | null;
	total: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	messages: number;
	systemChars: number;
}

export type FirstDifference =
	| { kind: "tools" }
	| { kind: "system"; section: string }
	| { kind: "message"; index: number }
	| { kind: "none" };

export interface MissCheck {
	cause: MissCause;
	found: boolean;
}

/**
 * A read-only reconstruction of a model call's request against the previous call's, from pi's own
 * context builder and the persisted system messages; nothing is assembled for or sent to a model.
 */
export interface RequestDiff {
	current: RequestSide;
	previous: RequestSide | null;
	gapMs: number | null;
	newTurn: boolean;
	miss: boolean;
	checks: readonly MissCheck[];
	firstDifference: FirstDifference;
	sections: readonly SectionDiff[];
	tools: ToolSetDiff;
	/** The current request's messages: every new or changed one, and the unchanged ones at the edges. */
	messages: readonly RequestMessage[];
	/** Messages of the previous request missing from this one (history a compaction rewrote). */
	removed: readonly RequestMessage[];
	removedCount: number;
	newCount: number;
}

export interface RequestDiffResult {
	apiVersion: number;
	found: boolean;
	diff: RequestDiff | null;
}

// ── Why the session is expensive ──

export interface CostCall {
	id: string;
	n: number;
	t: number;
	cost: number;
	tokens: number;
	context: number;
}

/** Consecutive calls of one plan step (or turn); a new turn or a compaction starts a new moment. */
export interface CostMoment {
	rank: number;
	turnId: string | null;
	turnN: number | null;
	stepId: string | null;
	stepN: number | null;
	stepTitle: string | null;
	phase: "beforeCompaction" | "afterCompaction" | null;
	t0: number;
	t1: number;
	llmCalls: number;
	toolCalls: number;
	errors: number;
	cost: Figure;
	tokens: Figure;
	/** Of the session's headline total. */
	share: number;
	/** The moment's value (cost, or tokens when the headline is tokens) per model call. */
	perCall: number;
	contextMin: number;
	contextMax: number;
	tools: readonly { name: string; n: number }[];
	topCall: { id: string; n: number; cost: number; tokens: number } | null;
}

/** A call that wrote most of a large context to the cache again. */
export interface CostSpike {
	id: string;
	n: number;
	t: number;
	cost: number;
	tokens: number;
	context: number;
	cacheRead: number;
	cacheWrite: number;
	gapMs: number | null;
	turnN: number | null;
	firstOfTurn: boolean;
	/** The cache-miss causes found between it and the previous call; empty: not derivable from the data. */
	causes: readonly MissCause[];
}

export type DiagnosisKind = "longContext" | "cacheRewrites" | "manyCalls" | "spread" | "none";

/** The figures the one-line diagnosis is filled from; every value is a sum or a count of recorded fields. */
export interface CostDiagnosis {
	kind: DiagnosisKind;
	calls: number;
	averageContext: number;
	peakContext: number;
	cacheReadShare: number;
	/** The median call's cost (tokens when the headline is tokens; the mean of the middle two for an even count). */
	medianCall: number;
	focus: {
		kind: "steps" | "turns";
		items: readonly { n: number; title: string; value: number }[];
		share: number;
		peakContext: number;
	} | null;
	/** The median call's value and request context of the 30 counted calls before the first compaction and of the 30 after it. */
	compaction: {
		beforeCall: number;
		afterCall: number;
		beforeContext: number;
		afterContext: number;
	} | null;
	/**
	 * Calls at or over 80 % of their own model's context window, for models whose window the host reports
	 * (a window known only as the largest context seen is no limit to be near): their count and value, and
	 * per model (by id) its threshold in tokens and calls.
	 */
	highContext: {
		calls: number;
		value: number;
		models: readonly { model: string; threshold: number; calls: number }[];
	} | null;
	rewrites: { calls: number; value: number } | null;
}

export interface SessionCost {
	revision: string;
	/** Tokens where every recorded cost is $0 ("not recorded"), else cost. */
	headline: "cost" | "tokens";
	total: Figure;
	tokens: Figure;
	calls: readonly CostCall[];
	moments: readonly CostMoment[];
	rest: { moments: number; value: number };
	/** Spend of compaction and branch summaries: not a model call of the conversation. */
	summaries: Figure;
	spikes: readonly CostSpike[];
	compactions: readonly { id: string; t: number; after: string | null }[];
	diagnosis: CostDiagnosis;
}

export interface SessionCostResult {
	apiVersion: number;
	found: boolean;
	cost: SessionCost | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Files ──

/** Turns, or plan steps inside turns when the session has few turns. */
export type FileColumnsKind = "turns" | "steps";

export interface FileColumn {
	turnId: string | null;
	turnN: number | null;
	stepId: string | null;
	stepN: number | null;
	title: string;
	t0: number;
}

/** `[column, reads, edits, writes, failed edits or writes]`. */
export type FileCell = readonly [number, number, number, number, number];

export interface FileReceiptSum {
	added: number;
	removed: number;
	runs: number;
}

export interface FileRow {
	/** Relative to the session's folder when inside it, else redacted (home as `~`). */
	path: string;
	/** Inside the session's folder: the host can open it in that workspace. */
	inside: boolean;
	reads: number;
	edits: number;
	writes: number;
	failed: number;
	/** Lines from the edit patches and written content (from tool calls). */
	added: number;
	removed: number;
	rework: boolean;
	cells: readonly FileCell[];
	/** What the host's turn receipts recorded for the file, when it has receipts for the session. */
	receipt: FileReceiptSum | null;
}

export interface FileTotals {
	files: number;
	changed: number;
	readOnly: number;
	rework: number;
	failed: number;
	added: number;
	removed: number;
}

export interface SessionFiles {
	revision: string;
	columns: FileColumnsKind;
	cols: readonly FileColumn[];
	rows: readonly FileRow[];
	/** Rows past the cap, not sent. */
	hidden: number;
	totals: FileTotals;
	/** The host has turn receipts for this session. */
	receipts: boolean;
	/** From the first model or tool call's start to the last one's end, for a file's touches over time. */
	start: number | null;
	end: number | null;
}

export interface SessionFilesResult {
	apiVersion: number;
	found: boolean;
	files: SessionFiles | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface FileDetailParams {
	sessionId: string;
	/** A `FileRow.path` of the session's files. */
	path: string;
}

export type FileOp = "read" | "edit" | "write";

export interface FileTouch {
	eventId: string;
	t: number;
	op: FileOp;
	failed: boolean;
	added: number;
	removed: number;
	/** Its matrix column. */
	column: number;
	/** The first changed line an edit reported. */
	line: number | null;
}

export interface FileDiff {
	eventId: string;
	t: number;
	op: "edit" | "write";
	failed: boolean;
	/** The edit's unified patch, or the written content; redacted and cut. */
	text: CappedText;
	line: number | null;
}

export interface FileReceipt {
	startedAt: number;
	settledAt: number;
	status: string;
	added: number | null;
	removed: number | null;
}

export interface FileDetail {
	row: FileRow;
	touches: readonly FileTouch[];
	diffs: readonly FileDiff[];
	/** Changes past the diff cap, not sent. */
	moreDiffs: number;
	receipts: readonly FileReceipt[];
}

export interface FileDetailResult {
	apiVersion: number;
	found: boolean;
	detail: FileDetail | null;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Statistics across sessions ──

/** A failure rate with its 95 % Wilson score interval: `k` of `n`, `low`…`high` as shares. */
export interface Rate {
	k: number;
	n: number;
	low: number;
	high: number;
}

/**
 * How many sessions in scope have their per-session facts (built once per file revision). `ready` counts
 * a session whose current revision is still being built from its previous revision's facts, so
 * `ready < total` exactly while some session has none yet (poll until then); `stale` is how many of
 * `ready` are such previous revisions (a live session that keeps growing).
 */
export interface DigestProgress {
	ready: number;
	total: number;
	stale: number;
}

/** A session the statistics refer to by its index in the result's `sessions`. */
export interface SessionRef {
	sessionId: string;
	title: string | null;
	firstPrompt: string | null;
	start: number | null;
	projectId: string | null;
	workspaceId: string | null;
	workspaceState: "open" | "removed" | "none";
}

export interface StatsParams {
	scope: SessionsListScope;
}

/**
 * A stacked series of the per-day chart. `model`: pi-recorded spend of one model's calls; `subagents`:
 * subagent spend pi mirrored into the session (`usage` entries of kind `subagent`); `other`: summaries
 * and other `usage` entries; `project`: a project's pi-recorded spend; `outside`: subagent spend outside
 * pi's total (never stacked into the headline); `otherModels` / `otherProjects`: those past the chart's
 * first six.
 */
export type UsageSeriesKind =
	| "model"
	| "otherModels"
	| "subagents"
	| "other"
	| "project"
	| "otherProjects"
	| "outside";

export interface UsageSeries {
	/** The model, the project id (`""` outside every project) or the kind. */
	key: string;
	kind: UsageSeriesKind;
	/** A project's name. */
	name: string | null;
	/** Per day of `StatsUsage.days`. */
	tokens: readonly number[];
	cost: readonly number[];
	totalTokens: number;
	totalCost: number;
	costOrigin: Origin;
}

/**
 * A change worth marking on the calendar: the first day of a model that never records cost
 * (`unpricedModel`), the day a model that recorded cost starts recording $0 for good (`costStopped`), the
 * first day with subagent spend (`subagentSpend`).
 */
export type UsageMarkerKind = "unpricedModel" | "costStopped" | "subagentSpend";

export interface UsageMarker {
	day: string;
	kind: UsageMarkerKind;
	model: string | null;
}

export interface UsageModelRow {
	model: string;
	/** Model calls that recorded usage, every branch. */
	calls: Figure;
	/** Calls that stopped with `error` or `aborted`. */
	errors: Figure;
	errorRate: Rate | null;
	tokens: Figure<TokenTotals>;
	cost: Figure;
	/** Cache read over the request context (input + cache read + cache write). */
	cacheShare: Figure;
	/** Median `durationMs` of the calls that recorded it. */
	latencyP50: Figure;
	measured: number;
	contextWindow: Figure;
	sessions: readonly number[];
	/** Tokens per sparkline point. */
	perDay: readonly number[];
}

export interface UsageProjectRow {
	/** `null`: sessions outside every project. */
	projectId: string | null;
	name: string | null;
	sessions: readonly number[];
	tokens: Figure<TokenTotals>;
	cost: Figure;
	outside: Figure<{ cost: number; tokens: number }>;
	models: readonly string[];
	/** Tokens per sparkline point. */
	perDay: readonly number[];
}

/** A tool, or a shell command by its head (`bun test`) in the commands table. */
export interface UsageToolRow {
	name: string;
	family: ToolFamily;
	calls: Figure;
	errors: Figure;
	errorRate: Rate | null;
	sessions: readonly number[];
	/** From the calls whose result recorded `durationMs`. */
	durationAvg: Figure;
	durationP50: Figure;
	measured: number;
	last: number | null;
	/** Calls per sparkline point. */
	perDay: readonly number[];
}

export interface UsageSkillRow {
	name: string;
	/** Sessions whose persisted skills section lists it. */
	listedSessions: number;
	/** Successful `SKILL.md` reads and `/skill:name` prompts. */
	loads: Figure;
	/** Sessions that loaded it. */
	sessions: readonly number[];
	/** Listed somewhere in scope and loaded nowhere. */
	neverLoaded: boolean;
	/** Its `<skill>` entry in the list, at pi's four characters a token, sent with every request. */
	descriptionTokens: Figure;
	last: number | null;
	/** Loads per sparkline point. */
	perDay: readonly number[];
}

export interface UsageRoleRow {
	role: string;
	runs: Figure;
	/** Runs that ended `failed`, `error` or `aborted`. */
	failed: Figure;
	failRate: Rate | null;
	tokens: Figure;
	cost: Figure;
	durationP50: Figure;
	sessions: readonly number[];
	/** Runs per sparkline point. */
	perDay: readonly number[];
}

/** The chart shows this many models (or projects); the rest stack as one `otherModels` series. */
export const USAGE_CHART_SERIES = 6;
/** A table row's per-day sparkline has at most this many points, each summing `sparkDays` days. */
export const SPARK_POINTS = 60;
/** The commands table lists this many command heads, most runs first. */
export const USAGE_COMMANDS = 100;

export interface StatsUsage {
	/** Every host-local calendar day of the scope, its first to its last day of activity. */
	days: readonly string[];
	/** Days each sparkline point sums (the last point may sum fewer). */
	sparkDays: number;
	/** Tokens when no session in scope records cost, else cost. */
	headline: "cost" | "tokens";
	byModel: readonly UsageSeries[];
	byProject: readonly UsageSeries[];
	outside: UsageSeries | null;
	markers: readonly UsageMarker[];
	totals: {
		tokens: Figure<TokenTotals>;
		cost: Figure;
		outside: Figure<{ cost: number; tokens: number }>;
	};
	models: readonly UsageModelRow[];
	projects: readonly UsageProjectRow[];
	tools: readonly UsageToolRow[];
	commands: readonly UsageToolRow[];
	skills: readonly UsageSkillRow[];
	roles: readonly UsageRoleRow[];
	/** Sessions with a persisted skills section (where "never loaded" can be judged). */
	listingSessions: number;
}

export interface StatsUsageResult {
	apiVersion: number;
	state: IndexState;
	digests: DigestProgress;
	sessions: readonly SessionRef[];
	usage: StatsUsage;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

/** Hotspot thresholds (rules in order; the first that matches names the row's action). */
export const HOTSPOT_RULES = {
	/** A spec changed in at least this many sessions → check it against the code. */
	specSessions: 3,
	/** A notes file (Markdown in a hidden folder) changed in this many sessions → make it a template. */
	templateSessions: 3,
	/** At least this many changes in one session → split the task. */
	splitChanges: 10,
	/** Code changed in at least this many sessions → describe it in AGENTS.md. */
	hubSessions: 3,
	/** At least this share of touches are reads, in this many sessions → describe the file upfront. */
	readShare: 0.7,
	readSessions: 4,
} as const;

/** Files sent by `stats.hotspots`, ranked; the heat tree is built over the same files. */
export const HOTSPOT_FILES = 300;

export type HotspotSort = "touches" | "changes" | "sessions";

export interface StatsHotspotsParams {
	scope: SessionsListScope;
	sort?: HotspotSort;
}

/**
 * The one rule-based action of a hotspot (rules in order): `spec` a spec changed in many sessions;
 * `test` a test reworked in a session; `plan` a notes file reworked; `template` a notes file changed in
 * many sessions; `split` many changes in one session; `hub` code changed in many sessions; `upfront` a
 * read-mostly file read in many sessions; `review` rework; `none`.
 */
export type HotspotAction =
	| "spec"
	| "test"
	| "plan"
	| "template"
	| "split"
	| "hub"
	| "upfront"
	| "review"
	| "none";

export interface HotspotFile {
	projectId: string | null;
	/** Workspace-relative (outside files are never listed). */
	path: string;
	/** Successful reads, edits and writes. */
	touches: Figure;
	reads: number;
	edits: number;
	writes: number;
	/** Failed edits and writes. */
	failed: number;
	/** Lines from the edit patches and written content (from tool calls). */
	added: number;
	removed: number;
	sessions: readonly number[];
	/** Sessions that edited or wrote it. */
	changedSessions: number;
	/** The most changes in one session, and that session. */
	rework: number;
	reworkSession: number | null;
	/** Sessions with at least `REWORK_CHANGES` changes. */
	reworkSessions: number;
	action: HotspotAction;
	/** An open workspace of the project to open the file in (the latest session's), else `null`. */
	workspaceId: string | null;
}

export interface HotspotDir {
	projectId: string | null;
	/** `""`: the workspace root. */
	path: string;
	touches: number;
	reads: number;
	edits: number;
	writes: number;
	failed: number;
	added: number;
	removed: number;
	files: number;
	/** Files below it with rework. */
	rework: number;
}

export interface StatsHotspots {
	sort: HotspotSort;
	/** The projects the files belong to, for their names. */
	projects: readonly ListProject[];
	files: readonly HotspotFile[];
	/** Every folder of the listed files, with sums over them. */
	dirs: readonly HotspotDir[];
	/** Files touched in scope (listed or not) and their touches. */
	totalFiles: number;
	touches: number;
	/** Touches not listed: outside the session's folder, or under `node_modules`. */
	outside: number;
	nodeModules: number;
	actions: Readonly<Record<HotspotAction, number>>;
	rules: typeof HOTSPOT_RULES;
	reworkChanges: number;
}

export interface StatsHotspotsResult {
	apiVersion: number;
	state: IndexState;
	digests: DigestProgress;
	sessions: readonly SessionRef[];
	hotspots: StatsHotspots;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

/** Thresholds of the findings' rules (decision 12 of the task spec, plus the ones this module chose). */
export const FINDING_RULES = {
	/** A command fails systematically: at least this many failures… */
	failingFailures: 3,
	/** …in at least this share of its runs… */
	failingShare: 0.08,
	/** …in at least this many sessions. */
	failingSessions: 2,
	/** Failing commands shown: the most failing ones, plus any whose Wilson lower bound reaches `failingStrong`. */
	failingShown: 4,
	failingStrong: 0.3,
	/** Cards a per-tool rule (loops, recovery, oversized output) shows at most. */
	toolCards: 3,
	/** A known non-error exit code seen at least this often. */
	falseErrors: 2,
	/** A loop: this many identical calls in a row… */
	loopCalls: 3,
	/** …happening at least this many times for one tool. */
	loops: 2,
	/** Poor recovery: at least this many failure chains, in this many sessions, recovered under this share. */
	recoveryChains: 5,
	recoverySessions: 2,
	recoveryShare: 0.5,
	/** A tool result this long (characters) is oversized… */
	oversizedChars: 50_000,
	/** …at least this many times for one tool. */
	oversizedCalls: 3,
	/** Cache misses in scope before their causes are summarized. */
	cacheMisses: 5,
	/** A session costs (or uses tokens) more than this many times the median… */
	outlierFactor: 3,
	/** …among at least this many sessions. */
	outlierSessions: 5,
	/** Subagent spend outside pi's totals worth reporting, in dollars. */
	outsideCost: 0.005,
	/** Files with rework listed as findings, and what rework is (changes of one file in one session). */
	reworkFiles: 3,
	reworkChanges: REWORK_CHANGES,
	/** Repeated instructions: sentences of at least this many words… */
	repeatWords: 6,
	/** …this similar (Jaccard of three-word shingles)… */
	repeatSimilarity: 0.6,
	/** …in at least this many sessions. */
	repeatSessions: 3,
	/** Repeated instructions listed as findings. */
	repeatFindings: 3,
	/** "Done without verification" claims before they are reported. */
	unverifiedClaims: 2,
} as const;

/** Exit codes that mean an answer, not a failure, for a command head (`false errors`). */
export type ExitMeaning = "checksPending" | "noMatch" | "differences" | "conditionFalse";

export const KNOWN_EXIT_CODES: readonly { head: string; exit: string; meaning: ExitMeaning }[] = [
	{ head: "gh pr checks", exit: "8", meaning: "checksPending" },
	{ head: "grep", exit: "1", meaning: "noMatch" },
	{ head: "rg", exit: "1", meaning: "noMatch" },
	{ head: "git grep", exit: "1", meaning: "noMatch" },
	{ head: "pgrep", exit: "1", meaning: "noMatch" },
	{ head: "diff", exit: "1", meaning: "differences" },
	{ head: "cmp", exit: "1", meaning: "differences" },
	{ head: "git diff", exit: "1", meaning: "differences" },
	{ head: "test", exit: "1", meaning: "conditionFalse" },
	{ head: "[", exit: "1", meaning: "conditionFalse" },
];

export type FindingGroup = "skills" | "commands" | "context" | "files";

export type FindingRule =
	| "skillNeverLoaded"
	| "skillUnlisted"
	| "commandFailing"
	| "falseError"
	| "loop"
	| "poorRecovery"
	| "oversizedOutput"
	| "contextLimit"
	| "cacheMisses"
	| "costOutlier"
	| "tokenOutlier"
	| "subagentsOutside"
	| "rework"
	| "repeatedInstruction"
	| "unverifiedClaim";

export type FindingSeverity = "error" | "warning" | "info";

/**
 * A finding's named figures: `median` and `largest` (outliers), `outside` and `recorded` (subagent
 * spend), `peak` and `window` (context), `perRequest` (a never-loaded skill list's tokens), `rewritten`
 * (tokens written to the cache again on misses), `largestOutput` (characters).
 */
export type FindingFigure =
	| "median"
	| "largest"
	| "outside"
	| "recorded"
	| "peak"
	| "window"
	| "perRequest"
	| "rewritten"
	| "largestOutput";

/**
 * A session behind a finding, `count` times, with up to three calls that open its analysis there; an
 * outlier's link carries its cost (or tokens) as `value`.
 */
export interface FindingLink {
	session: number;
	count: number;
	events: readonly string[];
	value?: number;
}

export interface FindingShare {
	key: string;
	count: number;
}

/** "What worked after a failure": the failed call's main argument against the next successful call's. */
export interface FindingDiff {
	session: number;
	failedEvent: string;
	workedEvent: string;
	segments: readonly DiffSegment[];
}

export interface Finding {
	/** Stable across reads (`command:bun test`, `skills:never`, …); `findings.hide` keys on it. */
	id: string;
	rule: FindingRule;
	group: FindingGroup;
	severity: FindingSeverity;
	/** A labelled heuristic rather than a count of recorded facts. */
	heuristic: boolean;
	hidden: boolean;
	/** The command head, tool, model, file path or quoted instruction the finding is about. */
	subject: string | null;
	count: number;
	total: number | null;
	rate: Rate | null;
	figures: Partial<Readonly<Record<FindingFigure, Figure>>>;
	/** The largest ratio the rule measured (× median, share). */
	ratio: number | null;
	/** Skills, models or other names the card lists. */
	names: readonly string[];
	/** Exit codes, miss causes or skills with their counts. */
	shares: readonly FindingShare[];
	/** The most common normalized error line, and in how many failures. */
	quote: { text: string; count: number } | null;
	worked: FindingDiff | null;
	links: readonly FindingLink[];
	/** Every session behind the finding, for *Show sessions*. */
	sessions: readonly number[];
	last: number | null;
}

export interface FindingsListResult {
	apiVersion: number;
	state: IndexState;
	digests: DigestProgress;
	sessions: readonly SessionRef[];
	findings: readonly Finding[];
	rules: typeof FINDING_RULES;
	exits: typeof KNOWN_EXIT_CODES;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

export interface FindingsHideParams {
	id: string;
	hidden: boolean;
}

export interface FindingsHideResult {
	apiVersion: number;
	hidden: readonly string[];
}

// ── Action sequences across sessions ──

/**
 * What a tool call does, for the action sequences: a fixed vocabulary in display order. Shell commands
 * split by their head (tests, builds, linters, git and gh, other runs; reading, searching and file
 * commands join `read`, `search` and `edit`); a `SKILL.md` read is `skill`; `mcp__*` tools are `mcp`.
 */
export const ACTIVITIES = [
	"search",
	"read",
	"edit",
	"test",
	"build",
	"lint",
	"git",
	"run",
	"plan",
	"specs",
	"subagent",
	"ask",
	"web",
	"skill",
	"mcp",
	"other",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

/** Thresholds of the sequence views. */
export const SEQUENCE_RULES = {
	/** A transition cell is marked "after errors" when at least this share of it starts at a failed call. */
	errorMarkShare: 0.05,
	/** Frequency thresholds the matrix's slider steps through (transitions per cell). */
	cellThresholds: [1, 2, 5, 10, 20, 50, 100, 200, 500],
	/** Edge thresholds the process map offers, as shares of all transitions. */
	edgeShares: [0.01, 0.02, 0.05],
	/** Sessions a cell lists, most occurrences first. */
	cellSessions: 7,
	/** Frequent chains: this many steps with consecutive repeats collapsed, this many listed. */
	chainSteps: 3,
	chainsShown: 9,
	/** What follows an error: steps followed after a failed call. */
	flowSteps: 3,
	/** A step state under this share of the failures in its column is grouped as `other`. */
	flowRareShare: 0.025,
	/** Failures listed in the "what fails most" table. */
	failuresShown: 8,
	/** Calls an example shows around a transition, and at most in a recovery example. */
	exampleSteps: 6,
} as const;

export interface StatsSequencesParams {
	scope: SessionsListScope;
}

/** A call of an example: its event in that session, what it did and whether it failed. */
export interface SequenceStep {
	eventId: string;
	tool: string;
	activity: Activity;
	label: string;
	failed: boolean;
}

export interface SequenceExample {
	session: number;
	steps: readonly (SequenceStep & { pair: boolean })[];
}

export interface ActivityNode {
	activity: Activity;
	calls: number;
	failed: number;
	/** Sessions whose first (last) call it is. */
	starts: number;
	ends: number;
	/** Transitions out of it (the matrix row's sum). */
	transitions: number;
}

/** Transitions from one activity to the next call's, across the scope's sessions. */
export interface SequenceCell {
	source: Activity;
	target: Activity;
	count: number;
	/** `count` over the `source` row's transitions. */
	share: number;
	/** Transitions whose first call failed. */
	afterError: number;
	/** `afterError` reaches `SEQUENCE_RULES.errorMarkShare` of `count`. */
	errorMark: boolean;
	/** Sessions where it occurs most (`SEQUENCE_RULES.cellSessions`), with their counts and first occurrence. */
	top: readonly { session: number; count: number; eventId: string }[];
	/** Every session where it occurs. */
	sessions: readonly number[];
	/** Its first occurrence in the session where it occurs most, with a call around it. */
	example: SequenceExample | null;
}

/** What the process map hides at one edge threshold. */
export interface EdgeThreshold {
	share: number;
	/** The smallest count an edge needs to show. */
	min: number;
	hiddenEdges: number;
	hiddenTransitions: number;
	/** Activities left without a shown edge. */
	hiddenNodes: readonly Activity[];
}

export interface SequenceChain {
	activities: readonly Activity[];
	count: number;
	share: number;
}

/**
 * A step after a failed call: the same tool (or command head) again, succeeding (`recovered`) or failing
 * (`repeatFailed`); another failure (`otherError`); reading or searching (`look`), editing (`edit`),
 * another run (`run`), anything else or a rare step (`other`); the session ended (`end`).
 */
export type FlowState =
	| "recovered"
	| "repeatFailed"
	| "look"
	| "edit"
	| "run"
	| "otherError"
	| "other"
	| "end";

/**
 * How a failure ended: retried successfully within the followed steps (`recovered`), later in the
 * session (`later`), never (`never`), or the session ended within the followed steps (`ended`).
 */
export type FlowOutcome = "recovered" | "later" | "never" | "ended";

/** Column 0 keys are the failed call's activity (`other` for rare ones), then states, then outcomes. */
export interface FlowNode {
	key: string;
	count: number;
}

export interface FlowLink {
	/** The column the link leaves (0 … flowSteps). */
	column: number;
	source: string;
	target: string;
	count: number;
}

/** A tool (or a command by its head) that fails, with how its failures ended. */
export interface FailureRow {
	key: string;
	tool: string;
	activity: Activity;
	failures: number;
	outcomes: Readonly<Record<FlowOutcome, number>>;
	sessions: readonly number[];
}

export interface SequenceFlow {
	failures: number;
	sessions: number;
	/** Columns: the failed call's activity, `SEQUENCE_RULES.flowSteps` step states, the outcome. */
	columns: readonly (readonly FlowNode[])[];
	links: readonly FlowLink[];
	failing: readonly FailureRow[];
	/** A real failure of the most failing tool that recovered within the followed steps. */
	example: {
		session: number;
		steps: readonly (SequenceStep & { state: FlowState | null })[];
	} | null;
}

export interface StatsSequences {
	/** The activities present, in `ACTIVITIES` order. */
	activities: readonly Activity[];
	nodes: readonly ActivityNode[];
	/** Non-empty cells, row by row. */
	cells: readonly SequenceCell[];
	calls: number;
	failed: number;
	transitions: number;
	/** Sessions with at least one tool call. */
	sessionsWithCalls: number;
	thresholds: readonly EdgeThreshold[];
	chains: readonly SequenceChain[];
	chainTotal: number;
	flow: SequenceFlow;
	rules: typeof SEQUENCE_RULES;
}

export interface StatsSequencesResult {
	apiVersion: number;
	state: IndexState;
	digests: DigestProgress;
	sessions: readonly SessionRef[];
	sequences: StatsSequences;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Slice comparison ──

/**
 * How two slices are cut: by each session's main model (most model calls), before and after a day
 * (`a` is the first day of B), by project, by the user's label (B is the rest when `b` is empty), or by
 * a text filter on the title and first prompt (B is the rest when `b` is empty).
 */
export type SliceBy = "model" | "period" | "project" | "label" | "filter";

export interface SlicesCompareParams {
	scope: SessionsListScope;
	by: SliceBy;
	/** Omitted: the server picks the two largest models or projects, or the day that splits the sessions in half. */
	a?: string;
	b?: string;
}

export const COMPARE_RULES = {
	/** Bootstrap resamples over sessions; the PRNG is seeded from the slices and the metric. */
	resamples: 2000,
	/** The interval's level. */
	level: 0.95,
	/** Fewer sessions with a value in either slice: no interval, "too few sessions". */
	minSessions: 3,
	/** Slices whose start ranges overlap less than this share of the shorter one differ in time. */
	timeOverlap: 0.25,
	/** Slices whose project (or model) mixes are at least this far apart (total variation) differ in task mix. */
	mixDistance: 0.3,
} as const;

/**
 * `sessions` counts; `failedShare` is the ratio of the sums of failed and all tool calls; `retries`
 * (retried attempts plus repeated calls) is a mean per session; the rest are medians per session.
 */
export type CompareMetricId =
	| "sessions"
	| "failedShare"
	| "toolCalls"
	| "turns"
	| "tokens"
	| "cost"
	| "activeTime"
	| "retries"
	| "contextPeak";

export type CompareStat = "count" | "ratio" | "median" | "mean";

/** Lower is better, or neither (the verdict then says higher or lower). */
export type CompareDirection = "lower" | "neutral";

/** `none`: the session count, which has no interval. */
export type CompareVerdict =
	| "none"
	| "better"
	| "worse"
	| "higher"
	| "lower"
	| "same"
	| "noData"
	| "tooFew";

/** The sessions behind a slice's figure (indices into `sessions`) and each one's value. */
export interface CompareSample {
	sessions: readonly number[];
	values: readonly number[];
}

export interface CompareMetric {
	id: CompareMetricId;
	stat: CompareStat;
	direction: CompareDirection;
	a: Figure;
	b: Figure;
	/** B − A, and B's change relative to A. */
	delta: number | null;
	relative: number | null;
	/** The bootstrap interval of `delta`; `null` without enough sessions or data. */
	low: number | null;
	high: number | null;
	verdict: CompareVerdict;
	sampleA: CompareSample;
	sampleB: CompareSample;
}

export interface SliceSide {
	key: string;
	/** A project's name, else `null`. */
	name: string | null;
	sessions: readonly number[];
	first: number | null;
	last: number | null;
}

/**
 * The slices also differ in something else: their start ranges barely overlap (`time`), or their
 * project or main-model mixes are far apart (`projects`, `models`; `distance` is the total variation).
 */
export type SliceConfound =
	| { kind: "time"; a: { first: number; last: number }; b: { first: number; last: number } }
	| { kind: "projects" | "models"; distance: number; a: string | null; b: string | null };

export interface SliceOption {
	key: string;
	name: string | null;
	sessions: number;
}

export interface SlicesCompare {
	by: SliceBy;
	a: SliceSide;
	b: SliceSide;
	metrics: readonly CompareMetric[];
	confounds: readonly SliceConfound[];
	/** Metrics whose interval excludes zero. */
	distinguishable: number;
	options: {
		models: readonly SliceOption[];
		projects: readonly SliceOption[];
		/** The user's labels on the scope's sessions, most used first. */
		labels: readonly SliceOption[];
		/** The first and last day with a session (host-local). */
		days: { first: string; last: string } | null;
	};
	rules: typeof COMPARE_RULES;
}

export interface SlicesCompareResult {
	apiVersion: number;
	state: IndexState;
	digests: DigestProgress;
	sessions: readonly SessionRef[];
	compare: SlicesCompare;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Two-session alignment ──

export const ALIGN_RULES = {
	/** Rows per `sessions.align` page. */
	pageRows: 1500,
	/** Turns after the first pair when their prompts' word overlap (Jaccard) reaches this. */
	turnSimilarity: 0.3,
	/** A matched pair is the same action when its objects overlap at least this much. */
	sameObjects: 0.25,
	/** Objects in more than this share of both sessions' calls are noise and ignored. */
	commonObjects: 0.3,
} as const;

export interface SessionsAlignParams {
	a: string;
	b: string;
	cursor?: number;
	/** Both sides' revisions from the first page: later pages align those snapshots while retained. */
	revisions?: { a: string; b: string };
}

/** A call of one side: what it did, its class for matching, its turn and when in that turn it started. */
export interface AlignStep {
	eventId: string;
	tool: string;
	activity: Activity;
	/** What matching compares: `skill:<name>`, `file`, `search`, a command head or the tool. */
	klass: string;
	label: string;
	failed: boolean;
	/** Index into the side's `turns`. */
	turn: number;
	/** Milliseconds from its turn's start. */
	offset: number;
}

export interface AlignTurn {
	n: number;
	eventId: string;
	trigger: TurnTrigger;
	label: string;
	calls: number;
	durationMs: number;
}

export interface AlignSide {
	sessionId: string;
	revision: string;
	turns: readonly AlignTurn[];
	calls: number;
}

/** Turns aligned with each other: the two first turns always, later ones by prompt similarity. */
export interface TurnPair {
	a: number;
	b: number;
	similarity: number;
	by: "first" | "prompt";
}

/**
 * One aligned row: the same action on both sides (`same`: the same class and shared objects), the same
 * kind of action (`similar`), or a call only one side made.
 */
export type AlignOp = "same" | "similar" | "onlyA" | "onlyB";

export interface AlignRow {
	op: AlignOp;
	a: number | null;
	b: number | null;
	/** The turn pair the row belongs to; `null` in a turn only one side has. */
	pair: number | null;
}

export interface SessionAlignment {
	a: AlignSide;
	b: AlignSide;
	pairs: readonly TurnPair[];
	totals: Readonly<Record<AlignOp, number>>;
	/** Matched calls over both sides' calls (Dice). */
	similarity: number;
	rows: readonly AlignRow[];
	/** The steps the page's rows name, by index. */
	stepsA: Readonly<Record<number, AlignStep>>;
	stepsB: Readonly<Record<number, AlignStep>>;
	cursor: number;
	next: number | null;
	totalRows: number;
	rules: typeof ALIGN_RULES;
}

export interface SessionsAlignResult {
	apiVersion: number;
	/** Both sessions are indexed and shown. */
	found: boolean;
	/** A side is not found yet while the index is still being built (and none is gone): ask again. */
	pending: boolean;
	alignment: SessionAlignment | null;
	/** A side is a pinned revision its file has moved past: reload after paging. */
	newerRevision: boolean;
	sources: Readonly<Record<MetricId, readonly string[]>>;
}

// ── Search across sessions ──

/** The filters a search query understands; `project` narrows the all-projects scope, `label` to the user's labels. */
export const SEARCH_FILTER_KEYS = [
	"tool",
	"error",
	"file",
	"skill",
	"model",
	"project",
	"label",
] as const;

export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number];

export const SEARCH_RULES = {
	/** Events a page shows across sessions; the scan stops after the session that reaches it. */
	pageEvents: 50,
	/** Events of one session a page shows; the rest arrive with that session's `more`. */
	groupEvents: 5,
	/** Events one `more` of a session adds. */
	moreEvents: 20,
	/** How long one request scans before it answers with what it found so far. */
	budgetMs: 250,
	/** Characters of a snippet, and how many of them come before its first match. */
	snippetChars: 160,
	snippetLead: 48,
	/** Free-text terms shorter than this are ignored, and at most `maxTerms` are used. */
	termMin: 2,
	maxTerms: 8,
	queryChars: 500,
	/** Values per facet in a result (the rest are summed as `others`) and per vocabulary dimension. */
	facetValues: 12,
	vocabularyValues: 200,
} as const;

/** `[start, end)` character offsets into the raw query. */
export interface SearchSpan {
	start: number;
	end: number;
}

export interface SearchFilter {
	key: SearchFilterKey;
	value: string;
	span: SearchSpan;
}

export interface SearchTerm {
	text: string;
	quoted: boolean;
	span: SearchSpan;
}

/**
 * The server's reading of a query: free-text terms (all must occur in one event), filters (every key
 * must match, any value of one key), `key:` tokens with an unknown key (searched as text) and what it
 * ignored (terms under `termMin` characters or past `maxTerms`, filters without a value).
 */
export interface ParsedSearch {
	terms: readonly SearchTerm[];
	filters: readonly SearchFilter[];
	unknown: readonly { key: string; span: SearchSpan }[];
	ignored: readonly SearchSpan[];
}

export interface SessionsSearchParams {
	scope: SessionsListScope;
	/** The asking panel: searches of different panels never cancel each other. */
	client: string;
	/** Grows with each new query of the client; a newer one cancels the older one's scan. */
	seq: number;
	query: string;
	/** Also send the scope's facet vocabulary for suggestions. */
	facets?: boolean;
	/** A previous answer's `next` (continue the scan) or a group's `more` (more of that session). */
	cursor?: string;
}

/** Where a match is: the prompt (or waking message), the model's reply, a call's arguments, its result, or error text. */
export type SearchField = "prompt" | "reply" | "args" | "result" | "error";

export interface SearchSnippet {
	field: SearchField;
	/** One line, redacted, at most `snippetChars` characters. */
	text: string;
	/** `[start, end)` of each term occurrence in `text`. */
	marks: readonly (readonly [number, number])[];
	/** The field's text goes on before / after the snippet. */
	head: boolean;
	tail: boolean;
}

export interface SearchHit {
	eventId: string;
	kind: "turn" | "llm" | "tool";
	/** The turn's number; 0 before the first turn. */
	turn: number;
	t: number;
	tool: string | null;
	/** The model of the call (a tool call: the model that issued it; a turn: the one that answered it). */
	model: string | null;
	/** The skill in action when the event started (a labelled heuristic: see `SkillActivation`). */
	skill: string | null;
	error: boolean;
	/** One redacted line: the call's main argument, the prompt, or the reply's first line. */
	label: string;
	/** Around the first match; `null` when the query has no free text (the label and error line say it). */
	snippet: SearchSnippet | null;
	/** How often the terms occur in each field that has a match. */
	fields: readonly { field: SearchField; count: number }[];
	/** A failed call's first error line, redacted. */
	errorLine: string | null;
}

export interface SearchGroup {
	/** Index into the answer's `sessions`. */
	session: number;
	/** The session's matching events (exact: a session is read to its end before it is shown). */
	matches: number;
	/** Events sent for the session so far, these included. */
	shown: number;
	events: readonly SearchHit[];
	/** Asks for the session's next events; `null` when all are shown. */
	more: string | null;
}

/** A facet value with its count; `""` is none (no skill in action, no project). */
export interface FacetCount {
	value: string;
	count: number;
}

export interface FacetValues {
	values: readonly FacetCount[];
	/** Events with a value past the first `facetValues`. */
	others: number;
}

/** Counts over the matches found so far (exact once `total.exact`). */
export interface SearchFacets {
	tool: FacetValues;
	model: FacetValues;
	skill: FacetValues;
	project: FacetValues;
	error: { yes: number; no: number };
}

/** The scope's values per filter with their events (failures for `error` clusters), for suggestions. */
export interface SearchVocabulary {
	tool: readonly FacetCount[];
	model: readonly FacetCount[];
	skill: readonly FacetCount[];
	file: readonly FacetCount[];
	error: readonly FacetCount[];
	project: readonly FacetCount[];
	/** The user's labels with each one's events (its sessions' searchable events). */
	label: readonly FacetCount[];
	/** Every session in scope was read. */
	complete: boolean;
}

/**
 * `scanning`: the request's time ran out, ask again with `next`; `more`: the page is full, `next` loads
 * the following one; `done`: every session was read; `superseded`: a newer query of the client replaced
 * this one; `expired`: the cursor's search is gone, ask again from the start.
 */
export type SearchStatus = "scanning" | "more" | "done" | "superseded" | "expired";

export interface SessionsSearchResult {
	apiVersion: number;
	seq: number;
	status: SearchStatus;
	state: IndexState;
	digests: DigestProgress;
	query: ParsedSearch;
	projects: readonly ListProject[];
	/** The sessions this answer's groups name. */
	sessions: readonly SessionRef[];
	/** Sessions with their events, newest session first, events in trace order; a session's `more` repeats its group. */
	groups: readonly SearchGroup[];
	/** Matches so far: at least these until `exact`. */
	total: { events: number; sessions: number; exact: boolean };
	/** Sessions read so far, of those in scope. */
	scanned: { sessions: number; total: number };
	facets: SearchFacets;
	vocabulary: SearchVocabulary | null;
	next: string | null;
}

// ── Labels and notes ──

/** Limits of the user's labels and notes, kept in the embedder's data folder (never in pi's files). */
export const LABEL_RULES = {
	/** Characters of one label after trimming and collapsing whitespace. */
	labelChars: 40,
	labelsPerSession: 12,
	noteChars: 2000,
	/** Sessions with a label or a note; a set that would pass it is refused. */
	sessions: 2000,
	/** Sessions whose notes one `labels.get` sends. */
	notesPerRequest: 100,
} as const;

export type LabelRules = typeof LABEL_RULES;

/** One session's labels (sorted, unique case-insensitively) and note. */
export interface SessionLabels {
	sessionId: string;
	labels: readonly string[];
	/** Sent only for the sessions a request asked for; else `null` even when `noted`. */
	note: string | null;
	noted: boolean;
}

export interface LabelsGetParams {
	/** Sessions whose notes to send (at most `notesPerRequest`); every labelled session's labels come regardless. */
	sessionIds?: readonly string[];
}

/** A label with how many sessions carry it. */
export interface LabelCount {
	label: string;
	sessions: number;
}

export interface LabelsGetResult {
	apiVersion: number;
	/** Every session with a label or a note, by session id. */
	sessions: readonly SessionLabels[];
	/** Every label in use, most sessions first, then by name. */
	vocabulary: readonly LabelCount[];
}

/** Replaces a session's labels and note; empty labels and an empty note forget the session. */
export interface LabelsSetParams {
	sessionId: string;
	labels: readonly string[];
	note: string | null;
}

/** `full`: the set would pass `LABEL_RULES.sessions`; nothing was written. */
export type LabelsSetResult =
	| { apiVersion: number; ok: true; session: SessionLabels; vocabulary: readonly LabelCount[] }
	| { apiVersion: number; ok: false; code: "LABELS_FULL" };

// ── Exports ──

/** What an export writes into the workspace's artifacts folder (`<artifacts>/session-insights/`). */
export type ExportKind = "html" | "trace" | "fixture";

export const EXPORT_RULES = {
	/** The folder under the workspace's artifacts folder every export goes to. */
	folder: "session-insights",
	/** HTML: characters kept per body after redaction (results keep a head and a tail). */
	html: { prompt: 8000, reply: 8000, thinking: 4000, args: 4000, result: 4000, error: 2000 },
	/** Fixture: the workspace snapshot is left out past these. */
	snapshot: { files: 400, bytes: 20 * 1024 * 1024 },
	/** The `cwd` an exported fixture records; the workflow harness rewrites it at replay. */
	fixtureCwd: "/tmp/thinkrail-fixture/workspace",
	/** Characters of a fixture name (letters, digits, `-`). */
	nameChars: 60,
} as const;

export type ExportRules = typeof EXPORT_RULES;

/** Where an e2e fixture's session is cut: the end of a turn, or right after an event. */
export type ExportCut = { kind: "turn"; turn: number } | { kind: "event"; eventId: string };

export interface ExportParams {
	sessionId: string;
	/** The open workspace whose artifacts folder receives the export (the asking panel's). */
	workspaceId: string;
	/** Add the user's labels and note; off unless asked. */
	includeLabels?: boolean;
}

export interface ExportFixtureParams extends ExportParams {
	/** Defaults to the end of the last turn. */
	cut?: ExportCut;
	/** The fixture's folder name; defaults to one derived from the session. */
	name?: string;
}

/**
 * Facts the result names: `labels` the user's labels and note went in; `snapshot` a workspace snapshot
 * from the host's turn tree went in; `noSnapshot` no turn tree matched the cut; `snapshotTooLarge` the
 * tree passed `EXPORT_RULES.snapshot`; `binaryOmitted` binary files of the tree were left out;
 * `childrenMissing` subagent transcripts were not found.
 */
export type ExportNote =
	| "labels"
	| "snapshot"
	| "noSnapshot"
	| "snapshotTooLarge"
	| "binaryOmitted"
	| "childrenMissing";

/**
 * What the post-export check can find: text that masking would still change (a private key, a key
 * shape, an auth header, a `*_KEY=` assignment, a query value, a JSON key, URL credentials, an email,
 * a home folder) or, in the HTML, a network resource reference.
 */
export type ExportCheckFinding =
	| "privateKey"
	| "keyShape"
	| "authHeader"
	| "assignment"
	| "queryValue"
	| "jsonKey"
	| "urlCredentials"
	| "email"
	| "homePath"
	| "networkReference";

/**
 * `SESSION_NOT_FOUND`: no shown session has the id; `NO_ARTIFACTS_DIR`: the workspace is not open or has
 * no artifacts folder; `CUT_NOT_FOUND`: the cut names no turn or event of the session; `CHECK_FAILED`:
 * the post-export check found a secret-like pattern (or a network reference), so nothing was written;
 * `WRITE_FAILED`: the file system refused the write.
 */
export type ExportErrorCode =
	| "SESSION_NOT_FOUND"
	| "NO_ARTIFACTS_DIR"
	| "CUT_NOT_FOUND"
	| "CHECK_FAILED"
	| "WRITE_FAILED";

export type ExportResult =
	| {
			apiVersion: number;
			ok: true;
			kind: ExportKind;
			/** Workspace-relative, `/`-separated: the file, or the fixture's folder. */
			path: string;
			files: number;
			bytes: number;
			notes: readonly ExportNote[];
	  }
	| {
			apiVersion: number;
			ok: false;
			kind: ExportKind;
			code: ExportErrorCode;
			/** What the check found (`CHECK_FAILED`), never the text itself. */
			found: readonly ExportCheckFinding[];
			/** A plain detail (an errno code, a cut); never a secret, a path or a body. */
			detail: string;
	  };
