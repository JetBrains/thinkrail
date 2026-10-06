import type { SessionState, ThinkingLevel, WireModel } from "./piProtocol";

export interface SessionStateRecord {
	sessionId: string;
	workspaceId: string;
	projectId: string;
	state: SessionState;
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
}

export type ProjectPathStatus = { kind: "repo" | "initable" | "missing" | "notDirectory" };

export interface DiffStats {
	added: number;
	removed: number;
}

export type SubagentOverride = "on" | "off";

/** `"settled"` = the user parked the workspace on the shelf; `"active"` = the user pinned it live. */
export type SettledOverride = "settled" | "active";

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
}

/** One settled worktree's would-be-lost work: `null` counts mean git could not answer. */
export interface SettledRemovalPreview {
	id: string;
	dirty: number | null;
	unpushed: number | null;
}

/** A row the client judged settled, with the activity stamp it judged from. */
export interface SettledRemovalTarget {
	id: string;
	lastActiveAt?: number;
}

export type SettledRemovalRefusal = "running" | "active" | "changed";

/** `kept` rows were no longer quiet when the host got to them and were left untouched. */
export interface SettledRemovalResult {
	removed: string[];
	kept: Array<{ id: string; reason: SettledRemovalRefusal }>;
}

export type GhSetupProblem = "missing" | "unauthenticated";

export interface PrDraft {
	title: string;
	body: string;
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
}

export interface BackgroundCommandCompletionDetails
	extends Omit<BackgroundCommandSummary, "command"> {
	status: "completed" | "error" | "stopped";
	finishedAt: number;
	output: { text: string; truncated: boolean };
}

export interface SubagentResourceSummary {
	childSessionId: string;
	parentSessionId: string;
	roleName?: string;
	task: string;
	status: DelegationRunStatus;
	createdAt: string;
	abortReason?: string;
	durationMs?: number;
}

export interface SessionResources {
	workspaceId: string;
	sessionId: string;
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
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
	| { kind: "pinned"; baseRef: string };

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

export type LayoutToolId = "projects" | "specs" | "files" | "changes" | "review";

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
	jbcentralQuotaEnabled: boolean;
	jbcentralQuotaRefreshSeconds: number;
	/** Which shell new workspace terminals start on Windows; ignored on other platforms. */
	terminalWindowsShell: TerminalWindowsShell;
	/** Idle days after which a quiet workspace settles onto its project's shelf; `null` = never. */
	settleIdleDays: number | null;
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

export type InterviewResponse = "book" | "postpone" | "never";

export const TERMINAL_REPLAY_KB = { min: 0, max: 1024, default: 64 } as const;

export const TERMINAL_WINDOWS_SHELLS = ["auto", "pwsh", "powershell", "cmd"] as const;
export type TerminalWindowsShell = (typeof TERMINAL_WINDOWS_SHELLS)[number];

export function isTerminalWindowsShell(value: unknown): value is TerminalWindowsShell {
	return TERMINAL_WINDOWS_SHELLS.some((shell) => shell === value);
}

export const SETTLE_IDLE_DAYS = { min: 1, max: 365, default: 3 } as const;

export function isSettleIdleDays(value: unknown): value is number | null {
	return (
		value === null ||
		(typeof value === "number" &&
			Number.isInteger(value) &&
			value >= SETTLE_IDLE_DAYS.min &&
			value <= SETTLE_IDLE_DAYS.max)
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
	jbcentralQuotaEnabled: true,
	jbcentralQuotaRefreshSeconds: JBCENTRAL_QUOTA_REFRESH_SECONDS.default,
	settleIdleDays: SETTLE_IDLE_DAYS.default,
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

export interface Review {
	id: string;
	workspaceId: string;
	status: "open" | "closed";
	baseSha: string;
	fileSessions?: Record<string, string>;
	doneFiles?: string[];
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
	findings: ReviewFixComment[];
	/** Host-set on an `approve` it refused to settle: findings from an earlier round are still open, so
	 * the step stays unreviewed until the worker resolves them. */
	blockedByOpenFindings?: number;
}

export const PLAN_REVIEW_VERDICTS: readonly PlanReviewVerdict[] = ["approve", "request_changes"];

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
	if (r.blockedByOpenFindings !== undefined && typeof r.blockedByOpenFindings !== "number")
		return false;
	if (!Array.isArray(r.findings)) return false;
	if (!r.findings.every(isReviewFinding)) return false;
	if (r.verdict === "request_changes" && r.findings.length === 0) return false;
	return true;
}
