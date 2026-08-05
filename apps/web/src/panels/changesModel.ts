import type {
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	RemoteDormantReason,
	RemoteState,
} from "@thinkrail/contracts";

/**
 * Token-utility classes for a changed file's *name*, encoding its git status without a letter glyph
 * (the VS Code / git-decoration convention), shared by the flat list and the tree so both read alike:
 * added / untracked → a muted green (dimmed so it doesn't shout next to the neutral rows), deleted → red +
 * strikethrough, renamed → blue, modified → plain (the `+/−` counts carry it). Applied on top of the row's
 * default `text-text-muted`.
 */
export function statusNameClass(status: GitFileStatus): string {
	switch (status) {
		case "added":
		case "untracked":
			return "text-feedback-success-muted";
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
 * The Changes read's **second identity dimension** (beyond the workspace): a change resets the list and
 * re-reads. The diff base joins it ONLY for the branch scope, because that is the one range measured
 * against the target (`merge-base(target, HEAD)`). The other three ranges — index→disk, HEAD→index,
 * `sha^`→`sha` — cannot move when the target is re-pointed, and keying them on it forced a
 * visible `Loading…` plus a re-read for a diff that provably could not change.
 *
 * Note this is NOT the same rule as `ChangesScopeMenu`'s `key`, which *does* depend on the base for every
 * scope: the commit list it offers really is `git log <base>..HEAD`.
 */
export function changesReadKey(scope: GitDiffScope, baseRef: string): string {
	return scope.kind === "branch" ? `${scopeKey(scope)}:${baseRef}` : scopeKey(scope);
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
	if (scope.kind === "commit") return `${base} · ${scope.sha.slice(0, 7)}`;
	return `${base} · ${scopeLabel(scope).toLowerCase()}`;
}

/**
 * The scope pill's label — the same vocabulary the scope menu offers. A commit reads as its **short sha**,
 * never its subject: a subject is a sentence, and letting it into a rail header would crowd the comparison
 * target beside it — inert text in commit scope, but still sharing the same tight flex row — down toward its
 * own ellipsis. The subject belongs to the menu row (and to the trigger's `title`, see {@link scopeTitle}).
 */
export function scopeLabel(scope: GitDiffScope, commits: readonly GitCommit[] = []): string {
	if (scope.kind === "branch") return "All changes";
	if (scope.kind === "working-tree") return "Working tree";
	if (scope.kind === "staged") return "Staged";
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
 * The comparison target pill's content — *the other side of this diff*, and whether that side is something
 * the user can choose. Only `branch` scope has a choosable other side (the re-pointable diff base); the
 * other three are facts about the scope itself, so they render as inert text rather than a control that
 * would do nothing when clicked.
 */
export function comparisonTargetLabel(
	scope: GitDiffScope,
	baseRef: string,
): { label: string; interactive: boolean } {
	switch (scope.kind) {
		case "branch":
			return { label: baseRef, interactive: true };
		case "working-tree":
			return { label: "index", interactive: false };
		case "staged":
			return { label: "HEAD", interactive: false };
		case "commit":
			return { label: "— (parent)", interactive: false };
	}
}

/** Why a dormant pair isn't being checked automatically, in the indicator's tooltip copy — see
 * {@link RemoteDormantReason}'s own doc for the full reasoning behind each rung. */
const DORMANT_REASON_TEXT: Record<RemoteDormantReason, string> = {
	disabled: "Automatic remote checks are turned off.",
	"upstream-gone": "This branch no longer exists on the remote — it was likely merged and deleted.",
	"never-authenticated": "Not checked automatically yet. Fetch once to check now and enable it.",
	"ssh-agent-present": "Skipped automatically — an SSH agent might prompt. Fetch to check now.",
	failing: "Automatic checks have been failing and backed off. Fetch to check now.",
};

/**
 * What a workspace's `↓` indicator, and its explanatory popover, actually show — the one place the
 * three-fidelity `behind` (see {@link RemoteState}) and an optional {@link RemoteDormantReason} become
 * glyph + tone + reason. `reason` is **always** populated for a non-null result — even an actively-checked
 * pair with a real count gets a plain-English sentence ("`origin/main` is 3 commits behind.") — so the
 * popover never has to fall back to composing its own text from the raw fields, **and** `RemoteIndicator`
 * reuses it verbatim as the trigger's `aria-label`: a bare glyph (`↓`, `↓·3`, a bare warning triangle) has
 * no accessible name of its own, and the whole point of this indicator is that a user notices and
 * understands it — most acutely for `"upstream-gone"`, whose visible content is icon-only. `null` means
 * there is nothing to render at all: up to date, and being checked automatically, so there is nothing to
 * explain.
 *
 * `"upstream-gone"` is deliberately its own `kind`, independent of `behind` — the branch is gone, so a
 * `↓`-shaped "behind by some amount" reading would be nonsensical, and (the Critical review finding this
 * guards) a dormant pair with `behind: null` must never render as bare absence, indistinguishable from
 * "up to date". Every *other* dormancy reason still renders the ordinary `↓`/`↓·N` glyph (muted, since it
 * reflects the last time it *was* checked, possibly a while ago) rather than nothing — the tooltip
 * explaining why is unreachable if there is nothing on screen to open it from, and `never-authenticated` /
 * `ssh-agent-present` most need that reachable Fetch affordance.
 */
export type RemoteIndicatorView =
	| { kind: "warning"; reason: string }
	| { kind: "behind"; text: string; muted: boolean; reason: string };

export function remoteIndicatorView(state: RemoteState): RemoteIndicatorView | null {
	if (state.dormant === "upstream-gone") {
		return { kind: "warning", reason: DORMANT_REASON_TEXT["upstream-gone"] };
	}
	// Three fidelities, never collapsed into one another: a real count only from a fetch, the bare arrow
	// when a probe knows the remote differs but not by how much, and `null` genuinely means nothing to say.
	const text =
		state.behind === null ? null : state.behind === "unknown" ? "↓" : `↓·${state.behind}`;
	if (!text) {
		if (!state.dormant) return null; // up to date, actively checked — the one true "nothing to render"
		return { kind: "behind", text: "↓", muted: true, reason: DORMANT_REASON_TEXT[state.dormant] };
	}
	if (state.dormant) {
		return { kind: "behind", text, muted: true, reason: DORMANT_REASON_TEXT[state.dormant] };
	}
	// Actively checked, genuinely behind: a plain sentence, not just the glyph, so the popover always has
	// something to say without composing its own text from the raw `behind` value.
	const reason =
		state.behind === "unknown"
			? `${state.ref} has new commits on the remote — fetch to see how many.`
			: `${state.ref} is ${state.behind} commit${state.behind === 1 ? "" : "s"} behind.`;
	return { kind: "behind", text, muted: false, reason };
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
