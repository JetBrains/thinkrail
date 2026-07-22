import type { GitFileChange, GitFileStatus } from "@thinkrail/contracts";

/**
 * Token-utility classes for a changed file's *name*, encoding its git status without a letter glyph
 * (the VS Code / git-decoration convention), shared by the flat list and the tree so both read alike:
 * added / untracked → a muted green (dimmed so it doesn't shout next to the neutral rows), deleted → red +
 * strikethrough, renamed → blue, modified → plain (the `+/−` counts carry it). Applied on top of the row's
 * default `text-muted`.
 */
export function statusNameClass(status: GitFileStatus): string {
	switch (status) {
		case "added":
		case "untracked":
			return "text-green/40";
		case "deleted":
			return "text-red line-through";
		case "renamed":
			return "text-blue";
		default:
			return ""; // modified — plain name; the diff counts convey the change
	}
}

/** A diff tab's id — the one-tab-per-file identity (re-clicking a row focuses the existing tab). */
export function diffTabId(workspaceId: string, path: string): string {
	return `${workspaceId}:diff:${path}`;
}

/** Whether `tabId` is a diff tab of `workspaceId` — the shared prefix of every `diffTabId` there. */
export function isDiffTabId(workspaceId: string, tabId: string | null | undefined): boolean {
	return tabId?.startsWith(`${workspaceId}:diff:`) ?? false;
}

export interface ChangeTreeFile {
	kind: "file";
	name: string;
	/** Path relative to the worktree root (the diff-tab key). */
	path: string;
	status: GitFileStatus;
	added: number;
	removed: number;
}
export interface ChangeTreeDir {
	kind: "dir";
	name: string;
	/** The directory's path relative to the worktree root (stable expand/collapse key). */
	path: string;
	children: ChangeTreeNode[];
	/** Sum of all descendant files' counts. */
	added: number;
	removed: number;
}
export type ChangeTreeNode = ChangeTreeDir | ChangeTreeFile;

interface DirBuild {
	dirs: Map<string, DirBuild>;
	files: ChangeTreeFile[];
}

/**
 * Build a folder tree from the flat `git.status` change list, aggregating each file's `+/−` counts up
 * into its folders. Directories sort before files, each alphabetically — the same shape the file tree
 * shows. Pure (no store/transport) so it's trivially unit-testable.
 */
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
				const path = prefix ? `${prefix}/${name}` : name;
				const children = materialize(child, path);
				let added = 0;
				let removed = 0;
				for (const node of children) {
					added += node.added;
					removed += node.removed;
				}
				return { kind: "dir", name, path, children, added, removed };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		const fileNodes = [...build.files].sort((a, b) => a.name.localeCompare(b.name));
		return [...dirNodes, ...fileNodes];
	};

	return materialize(root, "");
}
