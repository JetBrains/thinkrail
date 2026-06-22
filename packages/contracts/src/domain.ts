// App entities — the nouns the wire moves. project → workspace (git worktree) → {chats, files, terminals}.

export type TabStatus = "idle" | "running" | "waiting" | "error";

/** A git repository the user has opened. */
export interface Project {
	id: string;
	name: string;
	/** Absolute path to the git repo root. */
	path: string;
	/** Epoch ms of last open, for sort order. */
	lastOpened: number;
}

export interface DiffStats {
	added: number;
	removed: number;
}

/** A git worktree under a project — its own branch + cwd; the anchor for files/git/terminals/chats. */
export interface Workspace {
	id: string;
	projectId: string;
	name: string;
	branch: string;
	/** Absolute path to the worktree (the cwd everything downstream uses). */
	worktreePath: string;
	/** Branch the worktree's diff is measured against. */
	baseBranch: string;
	diffStats?: DiffStats;
}

/** A chat tab bound to a workspace. `id` is the UI tab id; `sessionId` is the pi `AgentSession` id. */
export interface Session {
	id: string;
	workspaceId: string;
	sessionId: string;
	title: string;
	status: TabStatus;
}

export type FileKind = "file" | "dir";

/** A node in a worktree's file tree. `children` is present once a directory is expanded (lazy). */
export interface FileNode {
	/** Path relative to the worktree root. */
	path: string;
	name: string;
	kind: FileKind;
	gitignored?: boolean;
	children?: FileNode[];
}

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	/** Path relative to the worktree root. */
	path: string;
	status: GitFileStatus;
}

export interface GitStatus {
	branch: string;
	changes: GitFileChange[];
}
