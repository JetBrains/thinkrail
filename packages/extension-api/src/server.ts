import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
	BranchReviewState,
	ChatState,
	Container,
	HistoryScope,
	OpenBranchReview,
	OpenPrResult,
	SessionCompletion,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/contracts";

export type {
	BranchReviewState,
	ChatState,
	Container,
	OpenPrResult,
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

/** What `host.events.subscribe` delivers, by event type. */
export interface ExtensionHostEvents {
	"session.state": SessionStateRecord;
	"workspace.created": Workspace;
	"workspace.updated": Workspace;
	"workspace.removed": { projectId: string; id: string };
	/** A chat's automatic work ended (pi's `agent_settled`, never an attempt-level `agent_end`). */
	"agent.settled": { workspaceId: string; sessionId: string };
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

/**
 * Named host writes, each refused (`EXTENSION_DISABLED`) while the extension is switched off. Queries
 * read; actions write through these, never through a shell or host internals.
 */
export interface ExtensionHostActions {
	/** A new managed workspace with a chat that starts on `kickoff` — the New Workspace dialog's creation. */
	createWorkspace(params: ExtensionCreateWorkspaceParams): Promise<ExtensionCreatedWorkspace>;
	/** A follow-up or steer into a chat, shown in its transcript as the extension's message. */
	sendToChat(params: {
		sessionId: string;
		text: string;
		mode: "follow_up" | "steer";
	}): Promise<void>;
	/** Stops a chat's running turn; `stopped: false` when it was not running. */
	stopChat(params: { sessionId: string }): Promise<{ stopped: boolean }>;
	/** Pushes the workspace's branch and opens (or updates) its PR, like the Open PR button. */
	openPr(params: {
		workspaceId: string;
		title?: string;
		body?: string;
		draft?: boolean;
	}): Promise<OpenPrResult>;
	/** Runs one program with `argv` (never a shell string) in the worktree of a repository workspace. */
	runInWorkspace(params: {
		workspaceId: string;
		argv: readonly string[];
		timeoutMs: number;
	}): Promise<ExtensionRunResult>;
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
