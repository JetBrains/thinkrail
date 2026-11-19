import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { HistoryScope, SessionCompletion, Workspace } from "@thinkrail/contracts";

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

export interface ExtensionHostServices {
	readonly dataDir: string;
	readonly log: ExtensionLog;
	/**
	 * Aborted when the user switches the extension off: the host drops the query table built with these
	 * services, so the table stops its background work and timers, and a switch back on builds a new one.
	 */
	readonly signal: AbortSignal;
	sessionsRoot(): string;
	sessionScope(scope: HistoryScope): ExtensionSessionView;
	childTranscriptDirs(parentSessionId: string, cwd: string): Promise<string[]>;
	sessionStatus(sessionId: string): ExtensionSessionStatus;
	/** `null` for a file outside `sessionsRoot()` or an entry no shown message leads to. */
	messageAnchor(sessionFile: string, entryId: string): Promise<ExtensionMessageAnchor | null>;
	/** A model's context window in tokens from the host's model catalog (overrides applied); `null` when unknown. */
	contextWindow(provider: string, model: string): Promise<number | null>;
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
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
