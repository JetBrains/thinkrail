export const CHANNEL_PREFIX = "pulse:";
export const MAX_FILES = 200;
export const MAX_COMMITS = 20;

export const channelKey = (workspaceId: string) => `${CHANNEL_PREFIX}${workspaceId}`;

export type Head =
	| { kind: "branch"; name: string; oid: string }
	| { kind: "unborn"; name: string }
	| { kind: "detached"; oid: string };

export interface Upstream {
	name: string;
	ahead: number;
	behind: number;
	gone: boolean;
}

export interface Counts {
	staged: number;
	unstaged: number;
	untracked: number;
	conflicted: number;
}

export type FileKind = "tracked" | "untracked" | "conflicted";

export interface FileChange {
	path: string;
	from?: string;
	kind: FileKind;
	index: string;
	worktree: string;
}

export interface Commit {
	hash: string;
	short: string;
	subject: string;
	author: string;
	time: number;
}

export interface Snapshot {
	head: Head;
	upstream?: Upstream;
	counts: Counts;
	files: FileChange[];
	filesTotal: number;
	stash: number;
	commits: Commit[];
}

export type Pulse =
	| { state: "loading"; path?: string }
	| { state: "not-git"; path: string }
	| { state: "error"; path?: string; message: string }
	| ({ state: "ready"; path: string } & Snapshot);

export interface FetchResult {
	ok: boolean;
	output: string;
	at: number;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const isFetchResult = (value: unknown): value is FetchResult =>
	isRecord(value) &&
	typeof value.ok === "boolean" &&
	typeof value.output === "string" &&
	typeof value.at === "number";

export const headLabel = (head: Head) =>
	head.kind === "detached" ? `detached @ ${head.oid.slice(0, 7)}` : head.name;

const UNITS = [
	["y", 365 * 86_400_000],
	["mo", 30 * 86_400_000],
	["d", 86_400_000],
	["h", 3_600_000],
	["m", 60_000],
] as const;

export const formatAgo = (ms: number) => {
	for (const [unit, size] of UNITS) if (ms >= size) return `${Math.floor(ms / size)}${unit} ago`;
	return "just now";
};
