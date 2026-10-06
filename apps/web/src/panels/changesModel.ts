import type {
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	TurnChangeSet,
} from "@thinkrail/contracts";
import { tupleKey } from "../lib";
import { extendFolderChain, startFolderChain } from "./folderChains";

export function statusNameClass(status: GitFileStatus): string {
	switch (status) {
		case "added":
		case "untracked":
			return "text-feedback-success";
		case "deleted":
			return "text-feedback-error line-through";
		case "renamed":
			return "text-feedback-info";
		default:
			return "";
	}
}

export function scopeKey(scope: GitDiffScope): string {
	if (scope.kind === "commit") return `commit:${scope.sha}`;
	if (scope.kind === "pinned") return `pinned:${scope.baseRef}`;
	if (scope.kind === "turn") return `turn:${scope.id}`;
	return scope.kind;
}

function scopeSuffix(scope: GitDiffScope): string {
	switch (scope.kind) {
		case "branch":
			return "";
		case "uncommitted":
			return "uncommitted";
		case "pinned":
			return scope.baseRef.slice(0, 7);
		case "commit":
			return scope.sha.slice(0, 7);
		case "turn":
			return `turn ${turnTimeLabel(scope.startedAt)}`;
	}
}

export function turnScope(turn: TurnChangeSet): Extract<GitDiffScope, { kind: "turn" }> {
	return {
		kind: "turn",
		id: turn.id,
		baseTree: turn.baseTree,
		headTree: turn.headTree,
		startedAt: turn.startedAt,
	};
}

export function turnTimeLabel(startedAt: number): string {
	return new Date(startedAt).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function diffTabId(workspaceId: string, scope: GitDiffScope, path: string): string {
	return tupleKey("diff", workspaceId, scopeKey(scope), path);
}

export function diffTabName(scope: GitDiffScope, path: string): string {
	const { base } = splitPath(path);
	const suffix = scopeSuffix(scope);
	return suffix ? `${base} · ${suffix}` : base;
}

export function changesTabId(workspaceId: string, scope: GitDiffScope): string {
	return tupleKey("changes", workspaceId, scopeKey(scope));
}

export function changesTabName(scope: GitDiffScope): string {
	const suffix = scopeSuffix(scope);
	return suffix ? `Changes · ${suffix}` : "Changes";
}

const GENERATED_PATH =
	/(^|\/)([^/]*\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.min\.(js|css)|[^/]*\.snap|[^/]*\.map)$/;
export const LARGE_SECTION_LINES = 400;
export const LARGE_SCOPE_FILES = 50;

export function sectionCollapsedByDefault(change: GitFileChange): boolean {
	return (
		(change.added ?? 0) + (change.removed ?? 0) > LARGE_SECTION_LINES ||
		GENERATED_PATH.test(change.path)
	);
}

const SECTION_CHROME_HEIGHT = 232;
const SECTION_HEIGHT_PER_LINE = 40;
const SECTION_HEIGHT_MAX = 20_000;

export function estimatedSectionHeight(change: GitFileChange): number {
	const lines = (change.added ?? 0) + (change.removed ?? 0);
	return Math.min(SECTION_HEIGHT_MAX, SECTION_CHROME_HEIGHT + lines * SECTION_HEIGHT_PER_LINE);
}

export function scopeLabel(
	scope: GitDiffScope,
	commits: readonly GitCommit[] = [],
	turns: readonly TurnChangeSet[] = [],
): string {
	if (scope.kind === "branch") return "All changes";
	if (scope.kind === "uncommitted") return "Uncommitted";
	if (scope.kind === "pinned") return scope.baseRef.slice(0, 7);
	if (scope.kind === "turn") {
		const latest = turns.at(-1);
		return latest && latest.id === scope.id
			? "Last turn"
			: `Turn ${turnTimeLabel(scope.startedAt)}`;
	}
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.shortSha ?? scope.sha.slice(0, 7);
}

export function scopeTitle(
	scope: GitDiffScope,
	commits: readonly GitCommit[] = [],
	turns: readonly TurnChangeSet[] = [],
): string {
	if (scope.kind === "turn") {
		const files = turns.find((turn) => turn.id === scope.id)?.changes.length;
		return `Agent turn at ${turnTimeLabel(scope.startedAt)}${files === undefined ? "" : ` · ${files} ${files === 1 ? "file" : "files"}`}`;
	}
	if (scope.kind !== "commit") return `Diff scope: ${scopeLabel(scope)}`;
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.subject ? `${known.shortSha} · ${known.subject}` : scopeLabel(scope, commits);
}

export function splitPath(path: string): { dir: string; base: string } {
	const cut = path.lastIndexOf("/");
	return cut < 0
		? { dir: "", base: path }
		: { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

export interface ChangeTreeFile {
	kind: "file";
	name: string;
	path: string;
	status: GitFileStatus;
	added: number;
	removed: number;
}
export interface ChangeTreeDir {
	kind: "dir";
	name: string;
	path: string;
	children: ChangeTreeNode[];
	added: number;
	removed: number;
}
export type ChangeTreeNode = ChangeTreeDir | ChangeTreeFile;

interface DirBuild {
	dirs: Map<string, DirBuild>;
	files: ChangeTreeFile[];
}

export function buildChangesTree(changes: readonly GitFileChange[]): ChangeTreeNode[] {
	const root: DirBuild = { dirs: new Map(), files: [] };

	for (const change of changes) {
		const segments = change.path.split("/");
		const fileName = segments.pop() ?? change.path;
		let dir = root;
		for (const segment of segments) {
			let next = dir.dirs.get(segment);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				dir.dirs.set(segment, next);
			}
			dir = next;
		}
		dir.files.push({
			kind: "file",
			name: fileName,
			path: change.path,
			status: change.status,
			added: change.added ?? 0,
			removed: change.removed ?? 0,
		});
	}

	const materialize = (build: DirBuild, prefix: string): ChangeTreeNode[] => {
		const dirNodes: ChangeTreeDir[] = [...build.dirs.entries()]
			.map(([name, child]): ChangeTreeDir => {
				const initialPath = prefix ? `${prefix}/${name}` : name;
				let chain = startFolderChain({ kind: "dir", name, path: initialPath });
				let children = materialize(child, initialPath);
				for (;;) {
					const extension = extendFolderChain(chain, children);
					if (!extension) break;
					chain = extension.chain;
					children = extension.directory.children;
				}
				let added = 0;
				let removed = 0;
				for (const node of children) {
					added += node.added;
					removed += node.removed;
				}
				return { kind: "dir", name: chain.label, path: chain.path, children, added, removed };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		const fileNodes = [...build.files].sort((a, b) => a.name.localeCompare(b.name));
		return [...dirNodes, ...fileNodes];
	};

	return materialize(root, "");
}
