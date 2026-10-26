import type { SessionState, ThinkingLevel, WireModel } from "./piProtocol";

export interface SessionStateRecord {
	sessionId: string;
	workspaceId: string;
	projectId: string;
	state: SessionState;
	firstPrompt?: string;
}

export const FIRST_PROMPT_MAX_LENGTH = 200;

const SKILL_BLOCK = /^\s*<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/;
const SKILL_COMMAND = /^\s*\/skill:(\S+)[ \t]*/;

export function clampToCodePoints(text: string, maxUnits: number): string {
	if (text.length <= maxUnits) return text;
	const last = text.charCodeAt(maxUnits - 1);
	return text.slice(0, last >= 0xd800 && last <= 0xdbff ? maxUnits - 1 : maxUnits);
}

const PACKAGE_HEADER = /^<[a-z][\w-]*(?:\s[^<>]*)?>$/;
const HEAD_SCAN_LIMIT = FIRST_PROMPT_MAX_LENGTH * 4;

function firstNonBlankLine(text: string): string | undefined {
	let start = 0;
	while (start < text.length) {
		const newline = text.indexOf("\n", start);
		const end = newline === -1 ? text.length : newline;
		const line = text
			.slice(start, Math.min(end, start + HEAD_SCAN_LIMIT))
			.replace(/\s+/g, " ")
			.trim();
		if (line) return line;
		if (newline === -1) break;
		start = newline + 1;
	}
	return undefined;
}

export function firstPromptHead(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const skill = SKILL_BLOCK.exec(text) ?? SKILL_COMMAND.exec(text);
	const body = skill ? text.slice(skill[0].length) || `/skill:${skill[1]}` : text;
	const line = firstNonBlankLine(body);
	if (!line || PACKAGE_HEADER.test(line)) return undefined;
	return clampToCodePoints(line, FIRST_PROMPT_MAX_LENGTH);
}

export function firstPromptOfTexts(texts: Iterable<string>): string | undefined {
	for (const text of texts) {
		if (isControlMessage(text)) continue;
		const head = firstPromptHead(text);
		if (head) return head;
	}
	return undefined;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	slug: string;
	lastOpened: number;
	closed?: true;
	trusted?: boolean;
	acknowledgedSkills?: string[];
	disabledSkills?: string[];
	disabledGroups?: string[];
	/**
	 * pi-level trust for the project's native `.pi/` resources, separate from the alias-skill `trusted`
	 * grant; absent (a record that predates pi-level trust) reads as untrusted. Never enables MCP servers by itself.
	 */
	piResourceTrust?: "granted" | "untrusted";
	/** Approved repo-defined MCP entries: server name → fingerprint of the original project-file entry. */
	mcpApprovals?: Record<string, string>;
	/** Per-project enablement/exposure of user-level MCP servers (never written to `.pi/mcp.json`). */
	mcpOverrides?: Record<string, McpProjectOverride>;
	/** "Always allow" MCP tools per server name (never written to `.pi/mcp.json`). */
	mcpToolGrants?: Record<string, McpToolGrant>;
}

/** Tools (pi tool names) granted while the server keeps the command + args or URL hashed as `target`. */
export interface McpToolGrant {
	target: string;
	tools: string[];
}

export type ProjectPathStatus = { kind: "repo" | "initable" | "missing" | "notDirectory" };

/** A kind of the project's own pi resources; `extensions` and `settings` run code on the host. */
export type ProjectResourceKind =
	| "extensions"
	| "settings"
	| "skills"
	| "prompts"
	| "themes"
	| "systemPrompt"
	| "subagents";

/**
 * What a project's trust grant would load, for the trust notice; alias skill names show only after trust.
 * `mcpServers` counts the entries of the project's `.pi/mcp.json`, each approved separately.
 */
export interface ProjectTrustSummary {
	aliasSkills: string[];
	/** The kinds of the project's own pi resources a pi-level grant would load; empty when none. */
	piResources: ProjectResourceKind[];
	mcpServers?: number;
}

export interface DiffStats {
	added: number;
	removed: number;
}

export type SubagentOverride = "on" | "off";

/** `"settled"` = the user parked the workspace on the shelf; `"active"` = the user pinned it live. */
export type SettledOverride = "settled" | "active";

export const DEFAULT_WORKSPACE_NAME = "Default";

export interface Workspace {
	id: string;
	projectId: string;
	kind?: "default" | "external";
	name: string;
	branch: string;
	worktreePath: string;
	baseBranch: string;
	diffBase?: string;
	renamed?: boolean;
	initialTerminalPending?: true;
	diffStats?: DiffStats;
	skillOverrides?: Record<string, "on" | "off">;
	subagentsOverride?: SubagentOverride;
	/** Per-chat concurrent-subagent limit for this workspace; absent = the global `subagentMaxConcurrent`. */
	subagentMaxConcurrentOverride?: number;
	/** Newest real activity (chat/agent turn, terminal input, HEAD move) in ms; viewing never counts. */
	lastActiveAt?: number;
	settledOverride?: SettledOverride;
	settledAt?: number;
	/** The host's last-known review for the branch; refreshed host-side so every client sees one state. */
	review?: OpenBranchReview;
}

export type BranchReviewState = "open" | "merged" | "closed";

export interface OpenBranchReview {
	kind: "pull-request" | "merge-request";
	number: number;
	/** The review's web page, when the provider reported one — what makes the `PR #N` chip a link. */
	url?: string;
	/** Absent on a pre-v78 host, which only ever reported open reviews. */
	state?: BranchReviewState;
	/** When the provider merged or closed the review, in ms. */
	changedAt?: number;
	/** `workspace.openReview` only: local commits origin/<branch> doesn't have yet. */
	unpushedCommits?: number;
	/**
	 * `workspace.openReview` only: last-known commits on origin/<branch> that HEAD doesn't have (the
	 * tracking ref may be cached when the fetch fails). A plain push must wait until they're integrated;
	 * this does not imply the checkout rewrote history or that a force-push is appropriate.
	 */
	behindCommits?: number;
	/** v88 `workspace.branchStatus` only: an open GitHub PR's live review facts. Never in the host snapshot. */
	details?: ReviewDetails;
}

export type ReviewDecision = "approved" | "changes_requested" | "review_required";

/** GitHub's `mergeStateStatus`, lower-cased. */
export type ReviewMergeState =
	| "clean"
	| "unstable"
	| "has_hooks"
	| "blocked"
	| "behind"
	| "dirty"
	| "draft"
	| "unknown";

export type MergeMethod = "squash" | "merge" | "rebase";

export interface ReviewChecks {
	passing: number;
	pending: number;
	failing: number;
	/** Bounded, in the provider's order. */
	failingNames: string[];
}

export interface ReviewDetails {
	draft: boolean;
	/** The branch the PR merges into now — it may have been retargeted since the workspace was made. */
	base?: string;
	/** Absent when the PR has no checks. */
	checks?: ReviewChecks;
	/** Absent when the repository requires no review and nobody decided. */
	reviewDecision?: ReviewDecision;
	/** Latest approving / change-requesting reviewers, bounded. */
	reviewers: { login: string; state: "approved" | "changes_requested" }[];
	mergeState: ReviewMergeState;
	/** What the repository allows; absent when `gh repo view` did not answer. */
	mergeMethods?: MergeMethod[];
	/** The repository deletes head branches on merge itself. */
	deleteBranchOnMerge?: boolean;
}

export interface MergePrResult {
	/** `false` when GitHub queued the PR (merge queue / auto-merge) instead of merging it now. */
	merged: boolean;
	/** `deleteBranch` only: whether `origin/<branch>` is gone — never deleted for a queued PR. */
	branchDeleted: boolean;
	/** Why the deletion after a successful merge failed. */
	deleteError?: string;
}

export type GhSetupProblem = "missing" | "unauthenticated";

export interface PrDraft {
	title: string;
	body: string;
}

export type PrBodySource = "plan" | "commits" | "template" | "empty";

export interface PrPreview extends PrDraft {
	/** v87: worktree-relative PR/MR templates the host found, in discovery order. */
	templates?: string[];
	/** v87: whether the session (when one was given) has a plan body to render. */
	planAvailable?: boolean;
	/** v87: the source the body was rendered from. */
	source?: PrBodySource;
}

export type ReviewProvider = "github" | "gitlab";

/** `workspace.branchStatus`: where the branch stands against origin and its base, review or not. */
export interface BranchStatus {
	hasOrigin: boolean;
	/** The forge `origin` points at; `null` without an origin or for any other host. */
	provider: ReviewProvider | null;
	/** The push repository has the branch; `null` when it couldn't be read (split origin, `ls-remote` failed). */
	published: boolean | null;
	/** Origin pushes to another URL than it fetches from: ahead/behind describe the push repository. */
	pushesElsewhere: boolean;
	/** Published only: local commits origin lacks. */
	ahead?: number;
	/** Published only: last-known origin commits HEAD lacks (the branch diverged). */
	behind?: number;
	/** Commits on HEAD that the workspace's base lacks. */
	aheadOfBase: number;
	/** The branch is its own base (Default on the default branch): no PR can be opened from it. */
	onBase: boolean;
	review: OpenBranchReview | null;
}

export interface OpenPrResult {
	action: "created" | "updated" | "pushed" | "compare";
	review?: OpenBranchReview;
	url?: string;
	compareUrl?: string;
	/** `updated` only: whether the `gh pr edit --body` refresh actually succeeded. */
	bodyRefreshed?: boolean;
	/** `compare` only: why the direct gh path was unavailable, when the host could tell. */
	ghProblem?: GhSetupProblem;
	dirtyFiles: number;
}

export type ExistingWorktreeCandidate =
	| { path: string; branch: string; status: "available" }
	| { path: string; status: "detached" };

export interface EditorInfo {
	id: string;
	label: string;
	kind: "gui" | "terminal";
}

export type WorkspaceSkillChange = "none" | "detected" | "unknown";

export interface WorkspaceFsChangedPayload {
	workspaceId: string;
	paths: string[];
	truncated: boolean;
	skillChange: WorkspaceSkillChange;
}

export type FileKind = "file" | "dir";

export interface FileNode {
	path: string;
	name: string;
	kind: FileKind;
	gitignored?: boolean;
	children?: FileNode[];
}

export interface ResourceMeta {
	hash: string | null;
	byteLength: number | null;
	text: boolean;
	mime?: string;
}

export interface SpecGraphNode {
	id: string;
	type: string;
	title: string;
	status?: string;
	path: string;
	parent?: string;
	dependsOn: string[];
	references: string[];
	implements: string[];
	tags: string[];
}

export interface SpecGraphSnapshot {
	nodes: SpecGraphNode[];
}

export type TodoStatus = "pending" | "in_progress" | "done";
export type TodoOrigin = "agent" | "user" | "adopted";

export type TodoArtifactKind = "file" | "change" | "spec" | "commit";

export interface TodoArtifact {
	kind: TodoArtifactKind;
	path?: string;
	label?: string;
	specId?: string;
	sha?: string;
	files?: GitFileChange[];
}

export interface TodoItem {
	id: string;
	title: string;
	status: TodoStatus;
	origin: TodoOrigin;
	note?: string;
	summary?: string;
	verification?: string;
	commitSubject?: string;
	artifacts?: TodoArtifact[];
	/**
	 * The item's review decoration — **host-derived on `todo.list`, present only on reviewable items**
	 * (those carrying a host change set). Review state is user-owned and host-stored (a sidecar, never the
	 * agent-writable plan file), so an agent re-plan can't flip a review decision.
	 */
	review?: TodoReviewInfo;
	createdAt: string;
	updatedAt: string;
}

export type TodoReviewState = "unreviewed" | "reviewed" | "changes_requested";

export interface TodoReviewInfo {
	state: TodoReviewState;
	reviewing?: boolean;
	reviewedBy?: "user" | "agent";
	revision: number;
	unreviewedShas?: string[];
	feedback?: string;
	at?: string;
}

export type TodoGroupStatus = "pending" | "active" | "done";

export interface TodoGroupItem {
	id: string;
	title: string;
	todos: TodoItem[];
	status: TodoGroupStatus;
}

export interface TodoPlan {
	todos: TodoItem[];
	groups: TodoGroupItem[];
	/**
	 * The agent's overall completion summary (`todo_plan_summary`), written when the whole plan is done.
	 * The plan page keeps it visible while an item re-opens, marked stale ("updating") until the agent
	 * rewrites it at the next completion; ungated external outputs (markdown export, PR body) still show it
	 * only while every item stays `done`, so a stale all-done story never leaves the app.
	 */
	summary?: string;
	/**
	 * Worktree changes attributed to NO item of this plan — **host-derived on `todo.list`, present only
	 * when non-empty**. The honesty section of the review map: work no item claims (edits before the
	 * first work window, after the last `done`, or in a chat that never planned) stays visible instead
	 * of silently absent.
	 */
	unattributed?: GitFileChange[];
	/** Committed counterpart of `unattributed`: `base..HEAD` commits no item owns, as wire-only `done` items (`origin: "adopted"`) — host-derived, never stored. See submodule-server-todos. */
	adoptedCommits?: TodoItem[];
}

export type DelegationRunStatus = "queued" | "running" | "completed" | "error" | "aborted";

const THINKING_LEVEL_SET = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
} satisfies Record<ThinkingLevel, true>;

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && Object.hasOwn(THINKING_LEVEL_SET, value);
}

const DELEGATION_RUN_STATUSES: readonly string[] = [
	"queued",
	"running",
	"completed",
	"error",
	"aborted",
];

export function isDelegationRunDetails(value: unknown): value is DelegationRunDetails {
	if (!value || typeof value !== "object") return false;
	const d = value as Partial<DelegationRunDetails>;
	if (typeof d.childSessionId !== "string" || typeof d.task !== "string") return false;
	if (typeof d.status !== "string" || !DELEGATION_RUN_STATUSES.includes(d.status)) return false;
	if (typeof d.durationMs !== "number") return false;
	for (const field of [d.roleName, d.roleSource, d.model, d.activity, d.abortReason]) {
		if (field !== undefined && typeof field !== "string") return false;
	}
	if (d.thinkingLevel !== undefined && !isThinkingLevel(d.thinkingLevel)) return false;
	const u = d.usage as Partial<DelegationRunDetails["usage"]> | undefined;
	return (
		!!u &&
		typeof u === "object" &&
		typeof u.input === "number" &&
		typeof u.output === "number" &&
		typeof u.cacheRead === "number" &&
		typeof u.cacheWrite === "number" &&
		typeof u.cost === "number" &&
		typeof u.turns === "number" &&
		typeof u.contextTokens === "number"
	);
}

export interface DelegationRunDetails {
	childSessionId: string;
	roleName?: string;
	roleSource?: string;
	task: string;
	status: DelegationRunStatus;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
		contextTokens: number;
	};
	durationMs: number;
	activity?: string;
	abortReason?: string;
}

export type CompletionDelivery = "wake" | "run" | "appended";

export interface SubagentCompletionDetails extends DelegationRunDetails {
	delivery?: CompletionDelivery;
}

export type BackgroundCommandStatus = "running" | "stopping" | "completed" | "error" | "stopped";

export interface BackgroundCommandSummary {
	id: string;
	sessionId: string;
	name: string;
	command: string;
	status: BackgroundCommandStatus;
	startedAt: number;
	finishedAt?: number;
	exitCode?: number | null;
	errorMessage?: string;
	/** The host or the chat's teardown ended this run; `status` is then terminal (see `interruptedResource`). */
	interrupted?: true;
}

export interface BackgroundCommandCompletionDetails
	extends Omit<BackgroundCommandSummary, "command"> {
	status: "completed" | "error" | "stopped";
	finishedAt: number;
	output: { text: string; truncated: boolean };
	delivery?: CompletionDelivery;
}

export interface SubagentResourceSummary {
	childSessionId: string;
	parentSessionId: string;
	roleName?: string;
	task: string;
	status: DelegationRunStatus;
	createdAt: string;
	detached?: boolean;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	abortReason?: string;
	durationMs?: number;
	finishedAt?: number;
	/** The host or the chat's teardown ended this run; `status` is then terminal (see `interruptedResource`). */
	interrupted?: true;
}

export type ResourceRecord =
	| { kind: "command"; summary: BackgroundCommandSummary }
	| { kind: "subagent"; summary: SubagentResourceSummary };

export type ResourceKind = ResourceRecord["kind"];

export type ResourceOutcome = "done" | "failed" | "stopped" | "interrupted";

export type ResourceTally = Record<ResourceOutcome, number>;

export interface SessionResourceHistory {
	commands: ResourceTally;
	subagents: ResourceTally;
}

export interface ResourceHistoryCursor {
	at: number;
	id: string;
}

export type ResourceHistoryPage =
	| { kind: "command"; items: BackgroundCommandSummary[]; hasMore: boolean }
	| { kind: "subagent"; items: SubagentResourceSummary[]; hasMore: boolean };

export const RESOURCE_HISTORY_PAGE_LIMIT = 20;
export const RESOURCE_HISTORY_MAX_PAGE_LIMIT = 100;

export function resourceRecordId(record: ResourceRecord): string {
	return record.kind === "command" ? record.summary.id : record.summary.childSessionId;
}

function hasLiveStatus(record: ResourceRecord): boolean {
	const { status } = record.summary;
	return record.kind === "command"
		? status === "running" || status === "stopping"
		: status === "queued" || status === "running";
}

export function isLiveResource(record: ResourceRecord): boolean {
	return !record.summary.interrupted && hasLiveStatus(record);
}

export function interruptedResource(record: ResourceRecord): ResourceRecord {
	return record.kind === "command"
		? {
				kind: "command",
				summary: {
					...record.summary,
					status: hasLiveStatus(record) ? "stopped" : record.summary.status,
					interrupted: true,
				},
			}
		: {
				kind: "subagent",
				summary: {
					...record.summary,
					status: hasLiveStatus(record) ? "aborted" : record.summary.status,
					interrupted: true,
				},
			};
}

export function resourceOutcome(record: ResourceRecord): ResourceOutcome | null {
	if (record.summary.interrupted) return "interrupted";
	if (record.kind === "command") {
		switch (record.summary.status) {
			case "completed":
				return record.summary.exitCode === 0 ? "done" : "failed";
			case "error":
				return "failed";
			case "stopped":
				return "stopped";
			default:
				return null;
		}
	}
	switch (record.summary.status) {
		case "completed":
			return "done";
		case "error":
			return "failed";
		case "aborted":
			return "stopped";
		default:
			return null;
	}
}

function emptyResourceTally(): ResourceTally {
	return { done: 0, failed: 0, stopped: 0, interrupted: 0 };
}

export function tallyResources(records: readonly ResourceRecord[]): ResourceTally {
	const tally = emptyResourceTally();
	for (const record of records) {
		const outcome = resourceOutcome(record);
		if (outcome) tally[outcome]++;
	}
	return tally;
}

export function resourceTallyTotal(tally: ResourceTally): number {
	return tally.done + tally.failed + tally.stopped + tally.interrupted;
}

export function resourceHistoryCursor(record: ResourceRecord): ResourceHistoryCursor {
	const at =
		record.summary.finishedAt ??
		(record.kind === "command" ? record.summary.startedAt : Date.parse(record.summary.createdAt));
	return { at: Number.isFinite(at) ? at : 0, id: resourceRecordId(record) };
}

export function compareResourceHistory(a: ResourceHistoryCursor, b: ResourceHistoryCursor): number {
	return b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export interface SessionResources {
	workspaceId: string;
	sessionId: string;
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	/** Absent on hosts without MCP support (`MCP_PROTOCOL_VERSION`). */
	mcpServers?: McpServerResourceSummary[];
	/** Every finished record of this chat by outcome; absent before `RESOURCE_HISTORY_PROTOCOL_VERSION`. */
	history?: SessionResourceHistory;
}

export type McpServerScope = "user" | "project";

/** Configured exposure; `codemode` is accepted from files and treated as `deferred` while codemode is not shipped. */
export type McpExposure = "deferred" | "direct" | "hidden" | "codemode";

export type McpTransportKind = "stdio" | "http";

export interface McpProjectOverride {
	enabled?: boolean;
	exposure?: Exclude<McpExposure, "codemode">;
}

/** The session-independent view of one configured server; secret literal values are masked. */
export interface McpServerSummary {
	name: string;
	scope: McpServerScope;
	/** Defining `mcp.json` path. */
	source: string;
	/** Fingerprint of the defining file's entry as rendered; `mcp.update` / `mcp.remove` name their target with it. */
	fingerprint: string;
	transport: McpTransportKind;
	/** Command + args, or URL, with literal credential values masked. */
	endpoint: string;
	exposure: McpExposure;
	effectiveExposure: Exclude<McpExposure, "codemode">;
	effective?: boolean;
	enabled: boolean;
	description?: string;
	/** HTTP server without an `Authorization` header: sign-in applies. */
	oauth: boolean;
	/** Project entry that shadows a user-level server of the same name. */
	replacesGlobal?: boolean;
	projectOverride?: McpProjectOverride;
	/** Repository content only: the project entry, or the repo override folded into a user row. */
	approval?: { state: "approved" | "pending" | "changed"; fingerprint: string };
	/** pi-equivalent validation message when the entry is rejected; credential-looking values are masked by the host. */
	configError?: string;
	/** Always-allowed tools still valid for the effective entry: pi's tool name and its display label. */
	alwaysAllowed?: { tool: string; label: string }[];
}

export type McpServerState =
	| "starting"
	| "connected"
	| "needs-sign-in"
	| "failed"
	| "disconnected"
	| "disabled"
	| "disabled-in-project"
	| "disabled-in-chat"
	| "pending-approval"
	| "invalid-config"
	| "pending-reload"
	| "not-running"
	| "handled-elsewhere"
	| "unknown";

export interface McpServerStatus {
	name: string;
	state: McpServerState;
	/** Server-reported count from pi's status text; absent when not connected. */
	toolCount?: number;
	/**
	 * pi's status line(s) for this server. pi does not redact them (connection errors, a stdio server's
	 * stderr tail), so the host masks credential-looking values before they leave it.
	 */
	detail?: string;
	updatedAt: number;
}

export interface McpStatusSnapshot {
	workspaceId: string;
	sessionId: string;
	/** Monotonic per session; a stale snapshot never overwrites a newer one. */
	generation: number;
	servers: McpServerStatus[];
}

export interface McpServerResourceSummary {
	name: string;
	state: McpServerState;
	toolCount?: number;
	transport: McpTransportKind;
	/** Registered by an extension (`pi.registerMcpServer()`), not an `mcp.json` entry: it cannot be disabled per chat. */
	registered?: true;
}

/** Mirror of pi's `McpToolDetails` as it arrives in `mcp__*` and the three MCP resource tools' results. */
export interface McpToolDetails {
	server: string;
	tool: string;
	fullOutputPath?: string;
}

export type McpContentBlockSummary =
	| { kind: "text"; chars: number }
	| { kind: "image"; mimeType: string }
	| { kind: "audio"; mimeType: string }
	| { kind: "resource_link"; uri: string; name?: string; mimeType?: string }
	| { kind: "resource"; uri: string; mimeType?: string; chars?: number };

/**
 * Bounded, base64-free presentation summary written into a tool result's `details.thinkrail` by the
 * host so cards render the same live, after reload, and on another client.
 */
export interface McpResultSummary {
	blocks: McpContentBlockSummary[];
	/** Blocks dropped from the end of `blocks` once the summary's byte budget was spent. */
	omittedBlocks?: number;
	structuredContent?: unknown;
	structuredContentTruncated?: boolean;
	isError?: boolean;
}

export type McpReadOutputResult =
	| { available: true; text: string; truncated: boolean }
	| { available: false; reason: "expired" | "unavailable" };

/** One server's lines from pi's shared MCP log (the messages servers send it), masked by the host. */
export interface McpServerLog {
	/** The file pi appends to: `mcp.log` in pi's agent directory. */
	path: string;
	/** The server's latest lines, oldest first and at most 200; empty when it logged nothing there. */
	text: string;
}

/** One raw `mcpServers` entry as written in a config file; validated by the host with pi-equivalent rules. */
export type McpServerEntryInput = Record<string, unknown>;

/** A problem with a whole `mcp.json` (unparsable JSON, `mcpServers` not an object, a mistyped top-level key), masked by the host. */
export interface McpConfigFileError {
	/** The file's path. */
	source: string;
	message: string;
}

export interface McpListResult {
	servers: McpServerSummary[];
	statuses: McpStatusSnapshot[];
	/** File-level problems of the files `servers` came from; absent when there are none or the host predates them. */
	configErrors?: McpConfigFileError[];
	/** MCP is provided by a user-installed extension or disabled through pi settings; management is read-only. */
	handledElsewhere?: { by: string };
}

export type BackgroundCommandOutputResult =
	| {
			available: true;
			command: BackgroundCommandSummary;
			output: { text: string; truncated: boolean };
	  }
	| { available: false };

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	path: string;
	status: GitFileStatus;
	added?: number;
	removed?: number;
}

export interface GitStatus {
	branch: string;
	changes: GitFileChange[];
}

export type GitDiffScope =
	| { kind: "branch" }
	| { kind: "uncommitted" }
	| { kind: "commit"; sha: string }
	| { kind: "pinned"; baseRef: string }
	| { kind: "turn"; id: string; baseTree: string; headTree: string; startedAt: number };

export interface TurnChangeSet {
	id: string;
	workspaceId: string;
	sessionId: string;
	startedAt: number;
	settledAt: number;
	baseTree: string;
	headTree: string;
	changes: GitFileChange[];
}

export interface GitCommit {
	sha: string;
	shortSha: string;
	subject: string;
	author: string;
	committedAt: string;
}

export interface LineSpan {
	start: number;
	count: number;
}

export type RevertTarget =
	| { kind: "file" }
	| { kind: "range"; original: LineSpan; modified: LineSpan };

export interface ChangeReceipt {
	id: string;
	workspaceId: string;
	path: string;
	kind: "revert" | "undo";
	at: number;
	before: { hash: string | null; byteLength: number | null; mode: number | null };
	after: { hash: string | null; byteLength: number | null; mode: number | null };
	trashed?: string;
}

export interface RemoteBranchGroup {
	remote: string | null;
	branches: { ref: string; branch: string }[];
}

export interface BranchList {
	local: string[];
	remote: string[];
	remoteGroups?: RemoteBranchGroup[];
	defaultBranch: string;
}

export type ProviderAuthKind = "oauth" | "api-key" | "env" | "central" | "other";

export interface ProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	kind?: ProviderAuthKind;
	detail?: string;
	canOAuth?: boolean;
	canApiKey?: boolean;
	canLogout?: boolean;
}

export type DetectedAccountSource =
	| "claude-code"
	| "codex"
	| "github-copilot"
	| "copilot-cli"
	| "kimi-cli"
	| "grok-build";

export interface DetectedAccount {
	providerId: string;
	source: DetectedAccountSource;
	plan?: string;
}

export interface JbcentralInstall {
	platform: string;
	shell: "bash" | "powershell";
	command: string;
}

export type JbcentralAction = "connect" | "disconnect" | "start-proxy" | "update";

export type JbcentralProbeFailureReason =
	| "launch-failed"
	| "timed-out"
	| "output-too-large"
	| "nonzero-exit";

export type JbcentralActionFailureReason =
	| "not-installed"
	| "unsupported-version"
	| "version-probe-failed"
	| "central-action-failed"
	| "artifact-missing"
	| "artifact-present"
	| "candidate-failed";

export type JbcentralStatus =
	| { state: "absent" }
	| { state: "outdated"; version: string }
	| { state: "supported"; version: string; signedOut: boolean }
	| {
			state: "configured";
			version: string;
			signedOut: boolean;
			proxyStopped: boolean;
	  }
	| { state: "malformed-version" }
	| { state: "probe-failed"; reason: JbcentralProbeFailureReason }
	| { state: "configuring"; action?: JbcentralAction }
	| {
			state: "load-failed";
			configured: boolean;
			action?: JbcentralAction;
			reason: "candidate-failed";
	  };

export function isJbcentralConnected(status: JbcentralStatus): boolean {
	return status.state === "configured" && !status.signedOut && !status.proxyStopped;
}

export interface ProviderStatusReport {
	providers: ProviderStatus[];
	jbcentral: JbcentralStatus;
	jbcentralInstall: JbcentralInstall;
}

export type JbcentralActionResult =
	| { outcome: "applied" }
	| { outcome: "failed"; reason: JbcentralActionFailureReason };

export type JbcentralConnectResult = JbcentralActionResult;

export type JbcentralLoginResult =
	| { outcome: "launched" }
	| {
			outcome: "failed";
			reason: "not-installed" | "unsupported-version" | "version-probe-failed" | "launch-failed";
	  };

export type JbcentralQuotaSnapshot =
	| { state: "hidden" }
	| { state: "available"; remaining: number; total: number; observedAt: number }
	| { state: "stale"; remaining: number; total: number; observedAt: number }
	| { state: "unavailable" };

export type LoginFrame =
	| { kind: "authUrl"; url: string; instructions?: string }
	| { kind: "deviceCode"; userCode: string; verificationUri: string; expiresInSeconds?: number }
	| { kind: "select"; message: string; options: { id: string; label: string }[] }
	| {
			kind: "prompt";
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
			secret?: boolean;
	  }
	| { kind: "progress"; message: string }
	| { kind: "success" }
	| { kind: "error"; message: string };

export interface LoginPush {
	loginId: string;
	providerId: string;
	frame: LoginFrame;
	/** Present for MCP server sign-ins; such pushes reach only the connection that started the login. */
	target?: { kind: "mcp"; workspaceId: string; serverName: string };
}

export interface LoginReply {
	loginId: string;
	value: string;
}

export interface GithubAuthStatus {
	connected: boolean;
	login?: string;
	scopes?: string[];
}

export interface HostEnvironmentVar {
	name: string;
	value: string;
}

export interface HostEnvironment {
	agentDir?: string;
	vars: HostEnvironmentVar[];
}

export type HostEnvironmentIssue =
	| { field: "agentDir"; code: "notAbsolute" | "notFound" | "notDirectory" }
	| { field: "var"; index: number; code: "invalidName" | "reserved" | "duplicate" };

export interface HostEnvironmentStatus {
	stored: HostEnvironment;
	restartRequired: boolean;
	launchOverridden: string[];
	effectiveAgentDir: string;
}

export type HostEnvironmentUpdateResult =
	| { ok: true; status: HostEnvironmentStatus }
	| { ok: false; issues: HostEnvironmentIssue[] };

export type ThemeId = string;

export const THEME_MODES = ["fixed", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface SystemThemePair {
	light: ThemeId;
	dark: ThemeId;
}

export interface ThemePreference {
	theme: ThemeId;
	themeMode: ThemeMode;
	systemThemePair?: SystemThemePair;
}

export function isThemeMode(value: unknown): value is ThemeMode {
	return THEME_MODES.some((mode) => mode === value);
}

export function isSystemThemePair(value: unknown): value is SystemThemePair {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof Reflect.get(value, "light") === "string" &&
		typeof Reflect.get(value, "dark") === "string"
	);
}

export type LayoutToolId = "projects" | "specs" | "files" | "review" | "plan";

export type LayoutBottomAlignment = "center" | "center-left" | "center-right" | "full";

export interface LayoutPresetCenterGroup {
	kind: "group";
	id: string;
}
export interface LayoutPresetCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutPresetCenterNode, LayoutPresetCenterNode];
}
export type LayoutPresetCenterNode = LayoutPresetCenterGroup | LayoutPresetCenterSplit;

export interface LayoutPresetSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tools: LayoutToolId[];
}
export interface LayoutPresetSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutPresetSideGroup[];
}

export interface LayoutPresetBottomGroup {
	id: string;
	weight: number;
	folded: boolean;
	tools: LayoutToolId[];
}

export interface LayoutPresetBottomRegion {
	visible: boolean;
	height: number;
	alignment: LayoutBottomAlignment;
	groups: LayoutPresetBottomGroup[];
}

export interface LayoutPreset {
	id: string;
	name: string;
	center: LayoutPresetCenterNode;
	left: LayoutPresetSideRegion;
	right: LayoutPresetSideRegion;
	bottom: LayoutPresetBottomRegion;
}

export const COMPOSER_GROWTH_LIMITS = ["compact", "roomy", "half-chat"] as const;
export type ComposerGrowthLimit = (typeof COMPOSER_GROWTH_LIMITS)[number];

export function isComposerGrowthLimit(value: unknown): value is ComposerGrowthLimit {
	return COMPOSER_GROWTH_LIMITS.some((limit) => limit === value);
}

export const LINE_WIDTH_COLUMNS = { min: 40, max: 240, default: 120 } as const;

export function isLineWidth(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= LINE_WIDTH_COLUMNS.min &&
		value <= LINE_WIDTH_COLUMNS.max
	);
}

export interface AppConfig extends ThemePreference {
	analyticsEnabled: boolean;
	analyticsConsentConfirmed: boolean;
	/** When true, the client may raise out-of-app attention notifications (still gated by browser permission). */
	notificationsEnabled: boolean;
	terminalReplayKb: number;
	composerGrowthLimit: ComposerGrowthLimit;
	chatLineWidth: number;
	fileLineWidth: number;
	chatLineWidthBounded: boolean;
	fileLineWidthBounded: boolean;
	customLayoutPresets: LayoutPreset[];
	/** The model new chats start with; unset uses the first available model. */
	defaultModel?: WireModel;
	/** New-chat effort; unset defaults to medium. */
	defaultEffort?: ThinkingLevel;
	/** The model the plan reviewer runs on; unset uses the host's new-chat model default. */
	reviewModel?: WireModel;
	/** Reviewer thinking level; unset uses the host's new-chat effort default, never the worker's inherited effort. */
	reviewEffort?: ThinkingLevel;
	/** Models the user starred in the picker, in display order; identity is `{provider, id}`. */
	favoriteModels: WireModel[];
	/** Models most recently chosen for a chat, newest first; host-maintained, never client-written. */
	recentModels: WireModel[];
	/** When false, a `request_changes` verdict records findings and waits — no automated fix cycle. */
	reviewAutoFix: boolean;
	/** When false, the worker's in-session `request_review` tool is withheld; the Review button still works. */
	agentReviewEnabled: boolean;
	subagentsEnabled: boolean;
	/** How many subagents one chat may run at once; more spawns queue FIFO. */
	subagentMaxConcurrent: number;
	jbcentralQuotaEnabled: boolean;
	jbcentralQuotaRefreshSeconds: number;
	/** Which shell new workspace terminals start on Windows; ignored on other platforms. */
	terminalWindowsShell: TerminalWindowsShell;
	/** Idle days after which a quiet workspace settles onto its project's shelf; `null` = never. */
	settleIdleDays: number | null;
	disabledExtensions: string[];
	/** UI language: `"system"` (follow the browser) or a BCP-47 tag; an unavailable tag renders English. */
	locale: string;
	/** The user finished or skipped the cold-start onboarding wizard. */
	onboardingDismissed: boolean;
}

export interface ExtensionCatalogEntry {
	name: string;
	title: string;
	description?: string;
	enabled: boolean;
	tools: string[];
	hasChildExtensions: boolean;
}

/** How many recently chosen models the host remembers. */
export const RECENT_MODELS_LIMIT = 5;

/** The `settings.update` payload: `null` clears an optional override back to unset (⇒ the default). */
export type AppConfigUpdate = Partial<
	Omit<
		AppConfig,
		"defaultModel" | "defaultEffort" | "reviewModel" | "reviewEffort" | "recentModels"
	>
> & {
	defaultModel?: WireModel | null;
	defaultEffort?: ThinkingLevel | null;
	reviewModel?: WireModel | null;
	reviewEffort?: ThinkingLevel | null;
};

export type SurveyInvitationResponse = "postpone" | "never";

export const SURVEY_OPEN_TEXT_LIMIT = 2000;

export type SurveyRatingScale = 3 | 5 | 7 | 10;

export function surveyRatingValues(scale: SurveyRatingScale): number[] {
	if (scale === 10) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	return Array.from({ length: scale }, (_, index) => index + 1);
}

interface SurveyQuestionBase {
	id: string;
	question: string;
	description?: string;
	optional?: true;
}

export interface SurveyOpenQuestion extends SurveyQuestionBase {
	type: "open";
}

export interface SurveyChoiceQuestion extends SurveyQuestionBase {
	type: "single_choice" | "multiple_choice";
	choices: string[];
	hasOpenChoice?: true;
	shuffleOptions?: true;
}

export interface SurveyRatingQuestion extends SurveyQuestionBase {
	type: "rating";
	display: "number" | "emoji";
	scale: SurveyRatingScale;
	lowerBoundLabel: string;
	upperBoundLabel: string;
}

export type SurveyQuestion = SurveyOpenQuestion | SurveyChoiceQuestion | SurveyRatingQuestion;

export interface AppSurvey {
	id: string;
	iteration: number;
	questions: SurveyQuestion[];
	placeholder?: string;
	thankYou?: string;
	shuffleQuestions?: true;
	language?: string;
}

export type SurveyAnswerValue = string | string[];

export interface SurveySubmitParams {
	submissionId: string;
	surveyId: string;
	iteration: number;
	language?: string;
	answers: Record<string, SurveyAnswerValue>;
	others?: Record<string, string>;
}

export const TERMINAL_REPLAY_KB = { min: 0, max: 1024, default: 64 } as const;

export const TERMINAL_WINDOWS_SHELLS = ["auto", "pwsh", "powershell", "cmd"] as const;
export type TerminalWindowsShell = (typeof TERMINAL_WINDOWS_SHELLS)[number];

export function isTerminalWindowsShell(value: unknown): value is TerminalWindowsShell {
	return TERMINAL_WINDOWS_SHELLS.some((shell) => shell === value);
}

export const SETTLE_IDLE_DAYS = { min: 1, max: 365, default: 7 } as const;

export function isSettleIdleDays(value: unknown): value is number | null {
	return (
		value === null ||
		(typeof value === "number" &&
			Number.isInteger(value) &&
			value >= SETTLE_IDLE_DAYS.min &&
			value <= SETTLE_IDLE_DAYS.max)
	);
}

export const SYSTEM_LOCALE_PREFERENCE = "system";

export function isLocalePreference(value: unknown): value is string {
	if (value === SYSTEM_LOCALE_PREFERENCE) return true;
	if (typeof value !== "string" || value.length === 0 || value.length > 35) return false;
	try {
		return Intl.getCanonicalLocales(value)[0] === value;
	} catch {
		return false;
	}
}

export interface LocalLocaleFileOk {
	fileName: string;
	tag: string;
	ok: true;
	strings: Record<string, string>;
}

export type LocalLocaleFileErrorCode =
	| "invalid-name"
	| "duplicate"
	| "too-large"
	| "too-many"
	| "unreadable"
	| "invalid-json"
	| "not-object";

export interface LocalLocaleFileError {
	fileName: string;
	tag: string | null;
	ok: false;
	error: LocalLocaleFileErrorCode;
	/** Parser or OS detail for `invalid-json` / `unreadable`, untranslated. */
	detail?: string;
}

export type LocalLocaleFile = LocalLocaleFileOk | LocalLocaleFileError;

/** The host's local language files (`<dataDir>/locales/`), as `locales.list` reports them. */
export interface LocalLocalesSnapshot {
	dir: string;
	files: LocalLocaleFile[];
}

export interface UserThemeFileOk {
	fileName: string;
	ok: true;
	/** The parsed JSON, unvalidated: the theme schema is owned by the web client. */
	manifest: unknown;
}

export type UserThemeFileErrorCode = "too-large" | "too-many" | "unreadable" | "invalid-json";

export interface UserThemeFileError {
	fileName: string;
	ok: false;
	error: UserThemeFileErrorCode;
	/** Parser or OS detail for `invalid-json` / `unreadable`, untranslated. */
	detail?: string;
}

export type UserThemeFile = UserThemeFileOk | UserThemeFileError;

/** The host's user theme files (`<dataDir>/themes/`), as `themes.list` reports them. */
export interface UserThemesSnapshot {
	dir: string;
	files: UserThemeFile[];
}

export const SUBAGENT_MAX_CONCURRENT = { min: 1, max: 16, default: 4 } as const;

export function isSubagentMaxConcurrent(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= SUBAGENT_MAX_CONCURRENT.min &&
		value <= SUBAGENT_MAX_CONCURRENT.max
	);
}

export const JBCENTRAL_QUOTA_REFRESH_SECONDS = { min: 1, max: 3600, default: 30 } as const;

export function isJbcentralQuotaRefreshSeconds(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= JBCENTRAL_QUOTA_REFRESH_SECONDS.min &&
		value <= JBCENTRAL_QUOTA_REFRESH_SECONDS.max
	);
}

export const DEFAULT_CONFIG: AppConfig = {
	theme: "dark",
	themeMode: "fixed",
	analyticsEnabled: false,
	analyticsConsentConfirmed: false,
	notificationsEnabled: true,
	terminalReplayKb: TERMINAL_REPLAY_KB.default,
	terminalWindowsShell: "auto",
	composerGrowthLimit: "half-chat",
	chatLineWidth: LINE_WIDTH_COLUMNS.default,
	fileLineWidth: LINE_WIDTH_COLUMNS.default,
	chatLineWidthBounded: true,
	fileLineWidthBounded: true,
	customLayoutPresets: [],
	favoriteModels: [],
	recentModels: [],
	reviewAutoFix: false,
	agentReviewEnabled: false,
	subagentsEnabled: true,
	subagentMaxConcurrent: SUBAGENT_MAX_CONCURRENT.default,
	jbcentralQuotaEnabled: true,
	jbcentralQuotaRefreshSeconds: JBCENTRAL_QUOTA_REFRESH_SECONDS.default,
	settleIdleDays: SETTLE_IDLE_DAYS.default,
	disabledExtensions: [],
	locale: SYSTEM_LOCALE_PREFERENCE,
	onboardingDismissed: false,
};

export function normalizeThemePreference(value: unknown): ThemePreference {
	const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
	const rawTheme = Reflect.get(record, "theme");
	const rawMode = Reflect.get(record, "themeMode");
	const rawPair = Reflect.get(record, "systemThemePair");
	const systemThemePair = isSystemThemePair(rawPair)
		? { light: rawPair.light, dark: rawPair.dark }
		: undefined;
	const themeMode =
		isThemeMode(rawMode) && (rawMode === "fixed" || systemThemePair)
			? rawMode
			: DEFAULT_CONFIG.themeMode;
	return {
		theme: typeof rawTheme === "string" ? rawTheme : DEFAULT_CONFIG.theme,
		themeMode,
		...(systemThemePair ? { systemThemePair } : {}),
	};
}

export const TODO_NUDGE_PREFIX = "[thinkrail:todo-nudge] ";

export function isControlMessage(text: string): boolean {
	return text.startsWith(TODO_NUDGE_PREFIX);
}

export const IMAGE_MAX_BASE64_BYTES = 4.5 * 1024 * 1024;

export function base64EncodedLength(byteLength: number): number {
	return Math.ceil(byteLength / 3) * 4;
}

export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
];

export const REQUEST_IMAGE_BASE64_BUDGET = 24 * 1024 * 1024;

export function isRetriedAttempt(
	messages: readonly { role: string; stopReason?: string }[],
	index: number,
): boolean {
	const message = messages[index];
	if (message?.role !== "assistant" || message.stopReason !== "error") return false;
	return messages[index + 1]?.role === "assistant";
}

export type HistoryScope =
	| { kind: "chat"; sessionId: string }
	| { kind: "workspace"; workspaceId: string }
	| { kind: "project"; projectId: string }
	| { kind: "all" };

export interface PromptHit {
	text: string;
	timestamp: number;
	sessionId: string;
	sessionTitle?: string;
	workspaceId?: string;
	projectId?: string;
	cwd: string;
	messageIndex?: number;
	anchorText?: string;
}

export interface MessageHit extends PromptHit {
	role: "user" | "assistant";
	snippet: string;
	messageIndex: number;
	anchorText: string;
}

export const MAX_HISTORY_LIMIT = 200;

export const MAX_HISTORY_QUERY_LENGTH = 200;

export interface HistorySearchResult {
	prompts: PromptHit[];
	messages: MessageHit[];
	promptTotal: number;
	messageTotal: number;
	indexing: boolean;
}

export const SEARCH_KINDS = ["chat", "transcript", "workspace", "file", "spec", "plan"] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export const MAX_SEARCH_QUERY_LENGTH = 200;

export const MAX_SEARCH_GROUP_LIMIT = 50;

export const DEFAULT_SEARCH_GROUP_LIMIT = 20;

/** Where the palette is: the active workspace, else the context project's folder, is the one root files and specs are searched in. */
export interface SearchContext {
	projectId?: string;
	workspaceId?: string;
}

export interface SearchHit {
	/** `kind:id[:locator]` — stable across replies so the client can keep a selection. */
	id: string;
	kind: SearchKind;
	title: string;
	subtitle?: string;
	snippet?: string;
	/** The shared matcher's tier and score; the client merges host hits with its own by these. */
	tier: number;
	score: number;
	ranges?: Record<string, [number, number][]>;
	projectId: string;
	workspaceId?: string;
	sessionId?: string;
	messageIndex?: number;
	anchorText?: string;
	/** Root-relative POSIX path of a file or spec hit. */
	path?: string;
	specId?: string;
	timestamp?: number;
}

export type SearchGroupState = "ready" | "truncated" | "indexing" | "failed";

export interface SearchGroup {
	kind: SearchKind;
	hits: SearchHit[];
	total: number;
	state: SearchGroupState;
}

export interface SearchQueryResult {
	seq: number;
	groups: SearchGroup[];
	/** A newer `seq` from the same client arrived while this one ran; `groups` is empty. */
	superseded?: true;
}

/** The transcript window around a chat hit; files and specs render client-side through `fs.readFile`. */
export interface SearchPreviewTarget {
	kind: "chat";
	sessionId: string;
	messageIndex?: number;
}

export interface SearchPreviewMessage {
	role: "user" | "assistant";
	messageIndex: number;
	text: string;
	focus: boolean;
}

export type SearchPreviewResult =
	| { kind: "transcript"; title: string; messages: SearchPreviewMessage[]; truncated: boolean }
	| { kind: "unavailable"; reason: "missing" };

export type TemplateScope = "global" | "project";

export interface TemplateInfo {
	name: string;
	description?: string;
	argumentHint?: string;
	scope: TemplateScope;
	filePath: string;
}

export interface Template extends TemplateInfo {
	content: string;
}

export type ReviewCommentKind = "inline" | "diff" | "file" | "review";

export type ReviewCommentStatus = "draft" | "sent" | "resolved" | "dismissed";

export type ReviewAnchorState = "anchored" | "moved" | "outdated";

export type ReviewSelector =
	| { kind: "lineRange"; startLine: number; endLine: number }
	| { kind: "textQuote"; exact: string; prefix: string; suffix: string }
	| { kind: "diffHunk"; hunkHeader: string }
	| { kind: "structural"; scheme: string; ref: string }
	| { kind: "region"; x: number; y: number; width: number; height: number; page?: number };

export interface ReviewAnchor {
	path: string;
	side: "base" | "worktree";
	baseRef?: string;
	scope?: GitDiffScope;
	contentHash?: string;
	selectors: ReviewSelector[];
}

export interface ReviewComment {
	id: string;
	reviewId: string;
	kind: ReviewCommentKind;
	anchor: ReviewAnchor | null;
	body: string;
	status: ReviewCommentStatus;
	anchorState: ReviewAnchorState;
	sessionId?: string;
	/** Who authored the remark — the human (default, absent) or the plan's reviewer agent. */
	author?: "user" | "agent";
	/** Provenance of an agent finding: the plan step (in its session) and the newest reviewed commit sha. */
	origin?: { todoId: string; reviewedSha: string; sessionId: string };
	/** Server-derived for the client, never persisted: the reviewed code was overwritten after review. */
	stale?: boolean;
	resolvedBy?: "agent" | "user";
	resolveNote?: string;
	createdAt: number;
	sentAt?: number;
	resolvedAt?: number;
}

export interface ReviewReadingStep {
	path: string;
	why: string;
}

/** The newest reviewer verdict's narrative for the workspace: its one-paragraph summary and the order it
 * suggests reading the change set in. Written by the host when a plan-step verdict lands; the Changes
 * review tab walks it. */
export interface ReviewGuide {
	summary: string;
	readingOrder: ReviewReadingStep[];
	verdict: PlanReviewVerdict;
	todoId: string;
	sessionId: string;
	reviewedSha: string;
	at: number;
}

export interface Review {
	id: string;
	workspaceId: string;
	status: "open" | "closed";
	baseSha: string;
	fileSessions?: Record<string, string>;
	doneFiles?: string[];
	guide?: ReviewGuide;
	createdAt: number;
	closedAt?: number;
}

export interface ReviewSnapshot {
	review: Review;
	comments: ReviewComment[];
}

export interface ReviewChangedPayload extends ReviewSnapshot {
	workspaceId: string;
}

/** A plan review that failed after `todo.startReview` acknowledged — the detached button/auto path has no
 * chat of its own, so the owning plan session raises the failure as a toast. `sessionId` routes it to that
 * plan only; duplicate views of one session dedupe on the toast body. See apps/web/src/panels/SPEC.md. */
export interface ReviewFailedPayload {
	workspaceId: string;
	sessionId: string;
	itemId: string;
	itemTitle: string;
	message: string;
}

/** Slim view of a sent review finding on a todo-review-fix message (path/lines pre-resolved host-side). */
export interface ReviewFixComment {
	id: string;
	kind: ReviewCommentKind;
	body: string;
	path?: string;
	startLine?: number;
	endLine?: number;
}

/** Structured payload of a todo-review-fix custom message; the message `content` stays the agent-read text. */
export interface ReviewFixDetails {
	itemId: string;
	itemTitle: string;
	reviewId?: string;
	/** The reviewer's/user's feedback prose (renderFixPackage note), when present. */
	note?: string;
	comments: ReviewFixComment[];
}

export type PlanReviewVerdict = "approve" | "request_changes";

/** Result of the worker-invoked request_review tool (Option A): a review subagent's structured verdict on
 * a plan step. Carried as the tool result's `details`, rendered by the request_review card, and written to
 * the item's review record. See submodule-server-host-plan-review + submodule-server-todos. */
export interface PlanReviewResult {
	itemId: string;
	itemTitle: string;
	verdict: PlanReviewVerdict;
	reviewedSha?: string;
	/** The reviewer's one-paragraph rationale (shown on the card). */
	summary?: string;
	/** The reviewer's suggested order for reading the change set, one line of why per file. */
	readingOrder?: ReviewReadingStep[];
	findings: ReviewFixComment[];
	/** Host-set on an `approve` it refused to settle: findings from an earlier round are still open, so
	 * the step stays unreviewed until the worker resolves them. */
	blockedByOpenFindings?: number;
}

export const PLAN_REVIEW_VERDICTS: readonly PlanReviewVerdict[] = ["approve", "request_changes"];
export const REVIEW_READING_ORDER_LIMIT = 12;

function isReadingStep(value: unknown): value is ReviewReadingStep {
	if (!value || typeof value !== "object") return false;
	const step = value as Partial<ReviewReadingStep>;
	return (
		typeof step.path === "string" &&
		step.path.length > 0 &&
		typeof step.why === "string" &&
		step.why.length > 0
	);
}

const REVIEW_COMMENT_KINDS: readonly ReviewCommentKind[] = ["inline", "diff", "file", "review"];

function isPositiveInt(n: unknown): n is number {
	return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/** A single reviewer finding: id + body required; kind (if present) a known enum; a line requires a path,
 * an endLine requires a startLine, and any range is positive and coherent. See submodule-server-host-plan-review. */
function isReviewFinding(f: unknown): f is ReviewFixComment {
	if (!f || typeof f !== "object") return false;
	const c = f as Partial<ReviewFixComment>;
	if (typeof c.id !== "string" || c.id.length === 0) return false;
	if (typeof c.body !== "string" || c.body.length === 0) return false;
	if (c.kind !== undefined && !REVIEW_COMMENT_KINDS.includes(c.kind)) return false;
	if (c.path !== undefined && typeof c.path !== "string") return false;
	if (c.startLine !== undefined && !isPositiveInt(c.startLine)) return false;
	if (c.endLine !== undefined && !isPositiveInt(c.endLine)) return false;
	if (c.startLine !== undefined && c.path === undefined) return false;
	if (c.endLine !== undefined && c.startLine === undefined) return false;
	if (c.startLine !== undefined && c.endLine !== undefined && c.endLine < c.startLine) return false;
	return true;
}

/** Validate the review subagent's parsed JSON verdict (untrusted — model output). Every finding field and
 * its enum/line coherence is checked, and the verdict/finding cardinality is enforced: a `request_changes`
 * with no actionable finding is rejected (it would strand the worker), while an `approve` may carry none. */
export function isPlanReviewResult(value: unknown): value is PlanReviewResult {
	if (!value || typeof value !== "object") return false;
	const r = value as Partial<PlanReviewResult>;
	if (typeof r.itemId !== "string" || typeof r.itemTitle !== "string") return false;
	if (typeof r.verdict !== "string" || !PLAN_REVIEW_VERDICTS.includes(r.verdict)) return false;
	if (r.summary !== undefined && typeof r.summary !== "string") return false;
	if (
		r.readingOrder !== undefined &&
		(!Array.isArray(r.readingOrder) ||
			r.readingOrder.length > REVIEW_READING_ORDER_LIMIT ||
			!r.readingOrder.every(isReadingStep))
	) {
		return false;
	}
	if (r.blockedByOpenFindings !== undefined && typeof r.blockedByOpenFindings !== "number")
		return false;
	if (!Array.isArray(r.findings)) return false;
	if (!r.findings.every(isReviewFinding)) return false;
	if (r.verdict === "request_changes" && r.findings.length === 0) return false;
	return true;
}
