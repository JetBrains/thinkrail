import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
	BranchReviewState,
	ChatState,
	Container,
	GhSetupProblem,
	HistoryScope,
	OpenBranchReview,
	SessionCompletion,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/contracts";

export type {
	BranchReviewState,
	ChatState,
	Container,
	GhSetupProblem,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
};

export type ToolResponse =
	| { kind: "response"; value: unknown }
	| { kind: "deferred" }
	| { kind: "abandoned" };

export interface WorkspaceFiles {
	check(path: string, cwd: string): Promise<void>;
	ensureArtifactsDir(cwd: string): Promise<void>;
	scratchDir: string;
	artifactsDir: string;
}

export interface ExtensionSessionServices {
	expectToolResponse(toolCallId: string): void;
	awaitToolResponse(toolCallId: string, signal: AbortSignal | undefined): Promise<ToolResponse>;
	setting(key: string): boolean;
	workspaceFiles: WorkspaceFiles;
}

export interface ExtensionBooleanSetting {
	type: "boolean";
	default: boolean;
}

export type ExtensionSetting = ExtensionBooleanSetting;

export interface InteractiveTool {
	describeResponse?: (args: unknown, response: unknown) => string | undefined;
}

export interface ArtifactTool {
	presented?: (args: unknown, details: unknown) => readonly string[];
	picked?: (args: unknown, details: unknown) => readonly string[];
}

export interface ExtensionLog {
	info(message: string): void;
	warn(message: string, error?: unknown): void;
}

export interface ExtensionHostWorkspace {
	id: string;
	name: string;
	/** `worktree`: a ThinkRail-managed worktree, whose record carries no `kind`. */
	kind: NonNullable<Workspace["kind"]> | "worktree";
	branch: string;
}

export interface ExtensionHostProject {
	id: string;
	name: string;
	kind: "repository" | "chats";
	workspaces: readonly ExtensionHostWorkspace[];
}

export type ExtensionWorkspaceState = "open" | "removed" | "none";

export interface ExtensionSessionPlacement {
	projectId: string | null;
	workspaceId: string | null;
	workspaceName: string | null;
	workspace: ExtensionWorkspaceState;
}

export interface ExtensionSessionView {
	readonly projects: readonly ExtensionHostProject[];
	/** `null`: hidden (a chat whose deletion is pending) or outside the scope. */
	locate(cwd: string): ExtensionSessionPlacement | null;
}

export interface ExtensionSessionStatus {
	live: boolean;
	completion: SessionCompletion | null;
}

/** Where a pi entry shows in the host's chat transcript (its display projection). */
export interface ExtensionMessageAnchor {
	messageIndex: number;
	anchorText: string;
	/** The requested entry, or its nearest ancestor the chat shows when it does not show the entry. */
	entryId: string;
	exact: boolean;
	/** For a message without text (a tool result, a tool-call-only assistant message): the call it shows. */
	toolCallId?: string;
}

/** A run's change set the host recorded for a session (ThinkRail: a turn receipt), paths workspace-relative. */
export interface ExtensionTurnReceipt {
	startedAt: number;
	settledAt: number;
	changes: readonly { path: string; status: string; added?: number; removed?: number }[];
}

/** A workspace's artifacts folder (the Artifacts tool's): absolute, and worktree-relative with a trailing `/`. */
export interface ExtensionArtifactsDir {
	dir: string;
	relative: string;
}

/** A regular file of a recorded workspace tree, its path worktree-relative (`/`-separated). */
export interface ExtensionTreeFile {
	path: string;
	bytes: Uint8Array;
}

/** A recorded tree's files, or its size when it passes the asked limits. */
export type ExtensionTurnTree =
	| { kind: "files"; files: readonly ExtensionTreeFile[] }
	| { kind: "tooLarge"; files: number; bytes: number };

/** A chat of an open workspace as the host reports it: contracts' `chatState`, unread, and its TODO plan's counts. */
export interface ExtensionChatFacts {
	sessionId: string;
	title: string;
	state: ChatState;
	unread: boolean;
	/** `null` when the chat keeps no plan. */
	plan: { open: number; total: number } | null;
	updatedAt: number;
	/**
	 * The live chat's most recent tool start, tracked by the host in memory (never parsed from the
	 * transcript): the tool's name and a short target — a workspace-relative path for read / edit / write,
	 * the start of a bash command — when it has one. Absent before the first tool and once the chat's
	 * session was disposed.
	 */
	lastAction?: { tool: string; target?: string; at: number };
}

/** A model a new chat can use, from the host's model catalog; `id` is `provider/id`, as `createWorkspace` takes it. */
export interface ExtensionModel {
	id: string;
	name: string;
	provider: string;
	thinkingLevels: ThinkingLevel[];
}

/** An open workspace's host facts: its last-known review, its diff against the base and its chats. */
export interface ExtensionWorkspaceFacts {
	id: string;
	projectId: string;
	name: string;
	branch: string;
	baseBranch: string;
	kind: ExtensionHostWorkspace["kind"];
	review: {
		kind: OpenBranchReview["kind"];
		number: number;
		state: BranchReviewState;
		url?: string;
	} | null;
	/** `null` for a chat without a project or when git could not tell. */
	diff: { added: number; removed: number } | null;
	chats: readonly ExtensionChatFacts[];
}

/** A task-spec of an open workspace's spec graph; `path` is worktree-relative, `status` `null` without one. */
export interface ExtensionTaskSpec {
	id: string;
	title: string;
	status: string | null;
	path: string;
}

/** A text file of a workspace, its path worktree-relative (`/`-separated). */
export interface ExtensionTextFile {
	path: string;
	text: string;
}

/**
 * An open repository workspace's `openspec/` tree: its `.md`, `.yaml` and `.yml` files by path, `truncated`
 * when the host's size cap stopped the read. Never a symlink followed, never a file outside `openspec/`.
 */
export interface ExtensionOpenspecTree {
	files: readonly ExtensionTextFile[];
	truncated?: true;
}

/** What `host.events.subscribe` delivers, by event type. */
export interface ExtensionHostEvents {
	"session.state": SessionStateRecord;
	"workspace.created": Workspace;
	"workspace.updated": Workspace;
	"workspace.removed": { projectId: string; id: string };
	/** A chat's automatic work ended (pi's `agent_settled`, never an attempt-level `agent_end`). */
	"agent.settled": { workspaceId: string; sessionId: string };
	/** A chat's agent started a tool (pi's `tool_execution_start`): its `lastAction` fact changed. */
	"agent.tool": { workspaceId: string; sessionId: string };
	"project.opened": { projectId: string };
	"project.closed": { projectId: string };
	"container.updated": Container;
	"container.removed": { id: string };
}

export type ExtensionHostEventType = keyof ExtensionHostEvents;

/** May be async: a rejection is logged like a throw. */
export type ExtensionHostEventListener<T extends ExtensionHostEventType> = (
	payload: ExtensionHostEvents[T],
) => void;

export interface ExtensionHostEventBus {
	/** Returns the unsubscribe. A listener that throws or rejects is logged and never breaks the host. */
	subscribe<T extends ExtensionHostEventType>(
		type: T,
		listener: ExtensionHostEventListener<T>,
	): () => void;
}

/** Which sockets an `extension.event` reaches: those that may see this workspace / project. */
export interface ExtensionPublishScope {
	workspaceId?: string;
	projectId?: string;
}

export interface ExtensionCreateWorkspaceParams {
	projectId: string;
	/** A branch or ref of the project; default: the project's default branch, freshly fetched. */
	baseRef?: string;
	/** A container the new workspace joins. */
	into?: string;
	name?: string;
	kickoff: {
		/** The first prompt, sent as is (pi's `/skill:` and `/template` expansion applies). */
		text: string;
		/** `provider/id` or a unique model id; default: the app's new-chat model. */
		model?: string;
		thinkingLevel?: ThinkingLevel;
	};
}

/** A new chat in an existing workspace whose first prompt is `kickoff` (pi's `/skill:` expansion applies). */
export interface ExtensionStartChatParams {
	workspaceId: string;
	kickoff: ExtensionCreateWorkspaceParams["kickoff"];
}

export interface ExtensionStartedChat {
	workspaceId: string;
	sessionId: string;
	/** Set when the chat started but did not take its first prompt (no model, no credentials). */
	kickoffError?: string;
}

export interface ExtensionCreatedWorkspace {
	workspaceId: string;
	sessionId: string;
	branch: string;
	/** Set when the chat started but did not take its first prompt. */
	kickoffError?: string;
}

export interface ExtensionRunResult {
	ok: boolean;
	out: string;
	err: string;
	timedOut: boolean;
}

/** One text file written into a repository workspace's worktree, at a relative path inside it. */
export interface ExtensionWriteWorkspaceFileParams {
	workspaceId: string;
	/** Worktree-relative, `/`-separated: never absolute, never `..`, never under `.git`. */
	path: string;
	/** UTF-8 text, at most 1 MiB. */
	content: string;
}

export interface ExtensionWrittenFile {
	workspaceId: string;
	/** The normalized worktree-relative path written. */
	path: string;
	bytes: number;
}

/** A container as an extension sees it: its members, in order, and its orchestrator chat once one started. */
export interface ExtensionContainer {
	id: string;
	name: string;
	workspaceIds: readonly string[];
	/** The orchestrator's chat (a chat without a project, in the Chats project) and its session. */
	orchestrator: { projectId: string; workspaceId: string; sessionId: string } | null;
}

/** A container's orchestrator as `startOrchestrator` answers it. */
export interface ExtensionStartedOrchestrator {
	containerId: string;
	projectId: string;
	workspaceId: string;
	sessionId: string;
}

/** An extension's update that wakes a container's orchestrator: its kind (`board-ready`) and its text. */
export interface ExtensionWakeOrchestratorParams {
	containerId: string;
	/** 1–40 lowercase letters, digits or dashes; one card per kind is in flight. */
	kind: string;
	/** At most 20,000 characters; the card frames it as the extension's, never the human's. */
	text: string;
}

/** One requirement an independent reviewer checks a workspace's change against; `id` is the caller's own. */
export interface ExtensionConformanceRequirement {
	id: string;
	text: string;
	/** Scenarios that make the requirement concrete (an OpenSpec requirement's `WHEN` / `THEN`). */
	scenarios?: readonly string[];
}

export interface ExtensionReviewConformanceParams {
	workspaceId: string;
	/** The chat the hidden reviewer runs under; by default the workspace's latest chat. */
	sessionId?: string;
	requirements: readonly ExtensionConformanceRequirement[];
	/** Why the change exists (the goal, the outcome), for the reviewer; may be empty. */
	context: string;
}

export type ExtensionConformanceVerdict = "met" | "unmet" | "untested";

/** Where the reviewer saw a requirement met or missed: a worktree-relative path, a line of it, and why. */
export interface ExtensionConformanceEvidence {
	path: string;
	line?: number;
	note: string;
}

export interface ExtensionConformanceItem {
	id: string;
	verdict: ExtensionConformanceVerdict;
	evidence: ExtensionConformanceEvidence[];
	/** The tests that cover it (paths or test names), empty when none does. */
	tests: string[];
}

/** The reviewer's advisory verdict: one item per requirement, in the requirements' order. */
export interface ExtensionConformanceResult {
	items: ExtensionConformanceItem[];
	summary: string;
}

/** An anchored remark on a workspace's diff, filed in its Review as authored by the extension. */
export interface ExtensionReviewCommentInput {
	path: string;
	line: number;
	side: "worktree" | "base";
	text: string;
}

/** A filed remark: `anchored` false when its line did not resolve and it became a review-level remark. */
export interface ExtensionAddedReviewComment {
	id: string;
	path: string;
	line: number;
	anchored: boolean;
}

/** One step of a chat's TODO plan as the agent wrote it: its title, status and completion notes. */
export interface ExtensionPlanStep {
	title: string;
	status: "pending" | "in_progress" | "done";
	summary?: string;
	verification?: string;
}

/** A chat's stored TODO plan, loose and grouped steps in order, with the plan's completion summary. */
export interface ExtensionPlanSummary {
	summary: string | null;
	steps: ExtensionPlanStep[];
}

/**
 * Named host writes, each refused (`EXTENSION_DISABLED`) while the extension is switched off. Queries
 * read; actions write through these, never through a shell or host internals.
 */
export interface ExtensionHostActions {
	/** A new managed workspace with a chat that starts on `kickoff` — the New Workspace dialog's creation. */
	createWorkspace(params: ExtensionCreateWorkspaceParams): Promise<ExtensionCreatedWorkspace>;
	/** A new chat in an open workspace of a repository project, starting on `kickoff` — a New chat with a first prompt. */
	startChat(params: ExtensionStartChatParams): Promise<ExtensionStartedChat>;
	/** A follow-up or steer into a chat, shown in its transcript as the extension's message. */
	sendToChat(params: {
		sessionId: string;
		text: string;
		mode: "follow_up" | "steer";
	}): Promise<void>;
	/** Runs one program with `argv` (never a shell string) in the worktree of a repository workspace. */
	runInWorkspace(params: {
		workspaceId: string;
		argv: readonly string[];
		timeoutMs: number;
	}): Promise<ExtensionRunResult>;
	/**
	 * Writes one text file at a relative path inside a repository workspace's worktree (parents created),
	 * leaving it uncommitted for the user; refuses an absolute path, `..`, `.git`, a symlink on the way and
	 * content past 1 MiB.
	 */
	writeWorkspaceFile(params: ExtensionWriteWorkspaceFileParams): Promise<ExtensionWrittenFile>;
	/**
	 * A one-shot ask on the host's assist model (through pi, never a second runtime), stopped once the
	 * services' `signal` aborts; `null` when no model is configured, it timed out or the answer was empty.
	 */
	assist(params: { prompt: string; maxTokens?: number }): Promise<{ text: string } | null>;
	/**
	 * A new container of these workspaces (the Projects tree's grouping, `container.create`): at least one,
	 * none in another container; two or more get their orchestrator at once.
	 */
	createContainer(params: {
		name?: string;
		workspaceIds: readonly string[];
	}): Promise<ExtensionContainer>;
	/** The container's one orchestrator (`container.startOrchestrator`): started, seeded with no turn, or answered as it is. */
	startOrchestrator(params: { containerId: string }): Promise<ExtensionStartedOrchestrator>;
	/**
	 * Wakes the container's orchestrator with the extension's update, starting its turn: coalesced and
	 * queued like the host's member updates (the latest text of a kind in the window wins, and one card per
	 * kind waits in its queue at most). Refused for an unknown container or one without an orchestrator.
	 */
	wakeOrchestrator(params: ExtensionWakeOrchestratorParams): Promise<void>;
	/**
	 * An independent, read-only check of a repository workspace's change against `requirements`: plan
	 * review's hidden reviewer subagent, on its model, under the workspace's chat. Advisory only — it edits
	 * nothing and approves nothing. One at a time per workspace; stopped once the services' `signal` aborts.
	 */
	reviewConformance(params: ExtensionReviewConformanceParams): Promise<ExtensionConformanceResult>;
	/**
	 * Files anchored remarks on a repository workspace's diff in its Review, authored by the extension
	 * (an agent remark with the extension's label) — never a human's, never an approval.
	 */
	addReviewComments(params: {
		workspaceId: string;
		comments: readonly ExtensionReviewCommentInput[];
		/** The author name the Review shows ("Smart review"), at most 40 characters; the extension's title by default. */
		author?: string;
	}): Promise<{ comments: ExtensionAddedReviewComment[] }>;
}

export interface ExtensionHostServices {
	readonly dataDir: string;
	readonly log: ExtensionLog;
	/**
	 * Aborted when the user switches the extension off: the host drops the query table built with these
	 * services, so the table stops its background work and timers, and a switch back on builds a new one.
	 */
	readonly signal: AbortSignal;
	readonly actions: ExtensionHostActions;
	readonly events: ExtensionHostEventBus;
	/**
	 * Pushes `extension.event { extension, type, payload }` to the clients that may see `scope`; dropped
	 * while the extension is off. `payload` must be JSON-serializable.
	 */
	publish(type: string, payload: unknown, scope?: ExtensionPublishScope): void;
	/** An open workspace's host facts (review, diff, chats with their state and plan); `null` otherwise. */
	workspaceFacts(workspaceId: string): Promise<ExtensionWorkspaceFacts | null>;
	/** The host's containers with their members and orchestrators. */
	containers(): readonly ExtensionContainer[];
	/** An open workspace's task-specs, from its spec graph; `null` for a workspace that is not open. */
	taskSpecs(workspaceId: string): Promise<readonly ExtensionTaskSpec[] | null>;
	/**
	 * An open repository workspace's `openspec/**` markdown and YAML (2 MiB in all, symlinks skipped);
	 * `null` without an `openspec/` folder or for a workspace that is not open.
	 */
	openspecTree(workspaceId: string): Promise<ExtensionOpenspecTree | null>;
	/** The text of one named section (`Deferrals`) of a spec of an open workspace; `null` without either. */
	specSection(workspaceId: string, specId: string, heading: string): Promise<string | null>;
	/**
	 * A chat's stored TODO plan — its steps' titles, statuses, summaries and verifications and the plan's
	 * summary; `null` for a workspace that is not open or an invalid session id.
	 */
	planSummary(workspaceId: string, sessionId: string): Promise<ExtensionPlanSummary | null>;
	/** Why the user's GitHub CLI (`gh`) cannot run now (`missing`, `unauthenticated`), else `null`. */
	githubProblem(): Promise<GhSetupProblem | null>;
	sessionsRoot(): string;
	sessionScope(scope: HistoryScope): ExtensionSessionView;
	childTranscriptDirs(parentSessionId: string, cwd: string): Promise<string[]>;
	sessionStatus(sessionId: string): ExtensionSessionStatus;
	/** `null` for a file outside `sessionsRoot()` or an entry no shown message leads to. */
	messageAnchor(sessionFile: string, entryId: string): Promise<ExtensionMessageAnchor | null>;
	/** A model's context window in tokens from the host's model catalog (overrides applied); `null` when unknown. */
	contextWindow(provider: string, model: string): Promise<number | null>;
	/** The models a new chat can use (the New Workspace dialog's picker), from the host's catalog. */
	models(): Promise<ExtensionModel[]>;
	/** The run receipts the host kept for a session, oldest first; empty when it kept none. */
	turnReceipts(sessionId: string): Promise<ExtensionTurnReceipt[]>;
	/**
	 * The workspace as one of the session's receipts (named by its `startedAt`) left it: the run's recorded
	 * tree, regular files only; `tooLarge` past `limits`; `null` when the host no longer has it.
	 */
	turnTree(
		sessionId: string,
		startedAt: number,
		limits: { files: number; bytes: number },
	): Promise<ExtensionTurnTree | null>;
	/**
	 * An open workspace's artifacts folder, recreated with its self-ignoring `.gitignore` when missing, for
	 * an extension to write what it produces for the user; `null` for a workspace that is not open.
	 */
	ensureArtifactsDir(workspaceId: string): Promise<ExtensionArtifactsDir | null>;
}

/** May return a Promise; the result must be JSON-serializable. */
export type ExtensionQuery = (params: unknown) => unknown;

/** A running host-lifetime service; `stop` releases what `hostService` started. */
export interface ExtensionHostService {
	stop?(): void | Promise<void>;
}

export interface ServerExtension {
	name: string;
	title?: string;
	description?: string;
	extensions: ExtensionFactory[];
	sessionExtensions?: (session: ExtensionSessionServices) => ExtensionFactory[];
	interactiveTools?: Record<string, InteractiveTool>;
	artifactTools?: Record<string, ArtifactTool>;
	settings?: Record<string, ExtensionSetting>;
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
	/**
	 * npm names of vanilla pi packages this extension replaces in the host's sessions (e.g. a command its
	 * panel covers): the host leaves a user-installed copy's extensions out while this extension is on.
	 */
	supersedesPackages?: readonly string[];
	apiVersion?: number;
	/** Called lazily on the first query while the extension is on, again after each switch-off; must not do I/O itself. */
	queries?: (host: ExtensionHostServices) => Readonly<Record<string, ExtensionQuery>>;
	/**
	 * Started once the host's publishers are wired and again each time the extension is switched back
	 * on; stopped when it is switched off and when the host stops. Must return promptly.
	 */
	hostService?: (host: ExtensionHostServices) => ExtensionHostService;
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
