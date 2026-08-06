import type { GitCommit, GitDiffScope, GitFileChange, GitFileStatus } from "@thinkrail/contracts";

/**
 * Token-utility classes for a changed file's *name*, encoding its git status without a letter glyph
 * (the VS Code / git-decoration convention), shared by the flat list and the tree so both read alike:
 * added / untracked → green, deleted → red + strikethrough, renamed → blue, modified → plain (the `+/−`
 * counts carry it) — each at full feedback strength so the new/removed/renamed names read clearly against
 * the neutral rows. Applied on top of the row's default `text-text-muted`.
 */
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
			return ""; // modified — plain name; the diff counts convey the change
	}
}

/**
 * A scope's stable string form — what makes the scope part of a diff tab's *identity*. A tab's content must
 * never change meaning because the rail's scope flipped underneath it, so two scopes of one file are two
 * tabs.
 */
export function scopeKey(scope: GitDiffScope): string {
	return scope.kind === "commit" ? `commit:${scope.sha}` : scope.kind;
}

/**
 * A diff tab's id — the one-tab-per-(file, scope) identity (re-clicking a row in the same scope focuses the
 * existing tab).
 */
export function diffTabId(workspaceId: string, scope: GitDiffScope, path: string): string {
	return `${workspaceId}:diff:${scopeKey(scope)}:${path}`;
}

/**
 * A diff tab's label. The basename alone for the default branch scope (today's look); other scopes append a
 * short scope tag, so the two tabs a scope switch can open are distinguishable in the tab strip.
 */
export function diffTabName(scope: GitDiffScope, path: string): string {
	const { base } = splitPath(path);
	if (scope.kind === "branch") return base;
	return `${base} · ${scope.kind === "uncommitted" ? "uncommitted" : scope.sha.slice(0, 7)}`;
}

/**
 * The scope pill's label — the same vocabulary the scope menu offers. A commit reads as its **short sha**,
 * never its subject: a subject is a sentence, and letting it into a rail header squeezes the sibling
 * target-branch pill down to an ellipsis. The subject belongs to the menu row (and to the trigger's
 * `title`, see {@link scopeTitle}).
 */
export function scopeLabel(scope: GitDiffScope, commits: readonly GitCommit[] = []): string {
	if (scope.kind === "branch") return "All changes";
	if (scope.kind === "uncommitted") return "Uncommitted";
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.shortSha ?? scope.sha.slice(0, 7);
}

/** The scope pill's tooltip — the long form of {@link scopeLabel} (a commit's subject, when known). */
export function scopeTitle(scope: GitDiffScope, commits: readonly GitCommit[] = []): string {
	if (scope.kind !== "commit") return `Diff scope: ${scopeLabel(scope)}`;
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.subject ? `${known.shortSha} · ${known.subject}` : scopeLabel(scope, commits);
}

/**
 * A path split for the **path row/chip**: a muted directory prefix (with its trailing slash) plus a bright
 * basename. One definition, shared by the Changes flat list and the diff header's chip so they read alike.
 */
export function splitPath(path: string): { dir: string; base: string } {
	const cut = path.lastIndexOf("/");
	return cut < 0
		? { dir: "", base: path }
		: { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
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
