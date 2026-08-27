import type { ThinkingLevel, WireModel } from "./piProtocol";

export type TabStatus = "idle" | "running" | "waiting" | "error";

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
}

export interface OpenBranchReview {
	kind: "pull-request" | "merge-request";
	number: number;
	/** `workspace.openReview` only: local commits origin/<branch> doesn't have yet. */
	unpushedCommits?: number;
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

export interface Session {
	id: string;
	workspaceId: string;
	sessionId: string;
	title: string;
	status: TabStatus;
}

export type FileKind = "file" | "dir";

export interface FileNode {
	path: string;
	name: string;
	kind: FileKind;
	gitignored?: boolean;
	children?: FileNode[];
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
export type TodoOrigin = "agent" | "user";

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
	 * Clients show it only while every item stays `done` — a re-opened plan hides it until the agent
	 * rewrites it at the next completion.
	 */
	summary?: string;
	/** The plan's dedicated reviewer chat (set once Start review ran) — the Reviewing label opens it. */
	reviewerSessionId?: string;
	/**
	 * Worktree changes attributed to NO item of this plan — **host-derived on `todo.list`, present only
	 * when non-empty**. The honesty section of the review map: work no item claims (edits before the
	 * first work window, after the last `done`, or in a chat that never planned) stays visible instead
	 * of silently absent.
	 */
	unattributed?: GitFileChange[];
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
	for (const field of [d.roleName, d.roleSource, d.model, d.activity]) {
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
}

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

export interface BranchList {
	local: string[];
	remote: string[];
	defaultBranch: string;
}

export type ProviderAuthKind = "oauth" | "api-key" | "env" | "other";

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

export type LayoutToolId = "projects" | "specs" | "files" | "changes" | "review";

export interface LayoutFileTab {
	kind: "file";
	id: string;
	name: string;
	path: string;
}

export interface LayoutDiffTab {
	kind: "diff";
	id: string;
	name: string;
	path: string;
	scope: GitDiffScope;
}

export interface LayoutChatTab {
	kind: "chat";
	id: string;
	name: string;
	sessionId: string;
}

export interface LayoutDocumentTab {
	kind: "document";
	id: string;
	name: string;
	documentKind: "todo-plan";
	sourceId: string;
	docPath: string;
}

export interface LayoutTerminalTab {
	kind: "terminal";
	id: string;
	name: string;
	tabKey: string;
}

export interface LayoutToolTab {
	kind: "tool";
	id: string;
	name: string;
	tool: LayoutToolId;
}

export type LayoutCenterTab =
	| LayoutFileTab
	| LayoutDiffTab
	| LayoutChatTab
	| LayoutDocumentTab
	| LayoutTerminalTab;
export type LayoutAuxiliaryTab = LayoutToolTab | LayoutTerminalTab;
export type LayoutSideTab = LayoutAuxiliaryTab;
export type LayoutTab = LayoutCenterTab | LayoutAuxiliaryTab;

export interface LayoutCenterGroup {
	kind: "group";
	id: string;
	tabs: LayoutCenterTab[];
	previewTabId?: string;
}

export interface LayoutCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutCenterNode, LayoutCenterNode];
}

export type LayoutCenterNode = LayoutCenterGroup | LayoutCenterSplit;

export interface LayoutSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutSideGroup[];
}

export type LayoutBottomAlignment = "center" | "center-left" | "center-right" | "full";

export interface LayoutBottomGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutBottomRegion {
	visible: boolean;
	height: number;
	alignment: LayoutBottomAlignment;
	groups: LayoutBottomGroup[];
}

export type LayoutAuxiliaryRegion = "left" | "right" | "bottom";

export interface LayoutToolRestoreTarget {
	region: LayoutAuxiliaryRegion;
	groupId?: string;
	index: number;
}

export interface WorkspaceLayoutDocument {
	version: 2;
	center: LayoutCenterNode;
	left: LayoutSideRegion;
	right: LayoutSideRegion;
	bottom: LayoutBottomRegion;
	toolRestoreTargets: Partial<Record<LayoutToolId, LayoutToolRestoreTarget>>;
}

export interface WorkspaceLayoutSnapshot {
	workspaceId: string;
	revision: number;
	document: WorkspaceLayoutDocument;
}

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

export interface AppConfig {
	theme: ThemeId;
	analyticsEnabled: boolean;
	terminalReplayKb: number;
	composerGrowthLimit: ComposerGrowthLimit;
	customLayoutPresets: LayoutPreset[];
	/** The model the plan reviewer + reflector run on; unset ⇒ the pi default. */
	reviewModel?: WireModel;
	/** Reviewer + reflector thinking level; unset ⇒ the model's default. */
	reviewEffort?: ThinkingLevel;
	/** When false, a `request_changes` verdict records findings and waits — no automated fix cycle. */
	reviewAutoFix: boolean;
}

/** The `settings.update` payload: `null` clears an optional override back to unset (⇒ the default). */
export type AppConfigUpdate = Partial<Omit<AppConfig, "reviewModel" | "reviewEffort">> & {
	reviewModel?: WireModel | null;
	reviewEffort?: ThinkingLevel | null;
};

export const TERMINAL_REPLAY_KB = { min: 0, max: 1024, default: 64 } as const;

export const DEFAULT_CONFIG: AppConfig = {
	theme: "dark",
	analyticsEnabled: true,
	terminalReplayKb: TERMINAL_REPLAY_KB.default,
	composerGrowthLimit: "half-chat",
	customLayoutPresets: [],
	reviewAutoFix: true,
};

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
	| { kind: "structural"; scheme: string; ref: string };

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
	/** An independent reflector's verdict on an agent finding (refuted findings are held back from auto-fix). */
	reflection?: {
		verdict: "kept" | "refuted";
		confidence: "low" | "medium" | "high";
		reason: string;
	};
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
