import type { GitCommit, GitDiffScope, GitFileChange, GitFileStatus } from "@thinkrail/contracts";
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
	return scope.kind;
}

export function diffTabId(workspaceId: string, scope: GitDiffScope, path: string): string {
	return tupleKey("diff", workspaceId, scopeKey(scope), path);
}

export function diffTabName(scope: GitDiffScope, path: string): string {
	const { base } = splitPath(path);
	if (scope.kind === "branch") return base;
	if (scope.kind === "uncommitted") return `${base} · uncommitted`;
	return `${base} · ${(scope.kind === "pinned" ? scope.baseRef : scope.sha).slice(0, 7)}`;
}

export function scopeLabel(scope: GitDiffScope, commits: readonly GitCommit[] = []): string {
	if (scope.kind === "branch") return "All changes";
	if (scope.kind === "uncommitted") return "Uncommitted";
	if (scope.kind === "pinned") return scope.baseRef.slice(0, 7);
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.shortSha ?? scope.sha.slice(0, 7);
}

export function scopeTitle(scope: GitDiffScope, commits: readonly GitCommit[] = []): string {
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
