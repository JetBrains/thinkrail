import type { GitDiffScope, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { git } from "./gitExec";

/**
 * The ref a workspace's changes are measured against: the **re-pointed** diff target when the user set one
 * (`workspace.setDiffBase`), else the ref the worktree was cut from. `Workspace` carries the two meanings
 * as two fields (`diffBase` = review target, `baseBranch` = creation provenance) and this is the single
 * place they collapse — every read goes through here rather than re-deriving `diffBase ?? baseBranch`.
 */
export function diffBaseRef(ws: Pick<Workspace, "baseBranch" | "diffBase">): string {
	return ws.diffBase ?? ws.baseBranch;
}

/**
 * What a {@link GitDiffScope} *means* in git terms — the one definition shared by both reads (the changed
 * file list and a single file's two sides), so "what is being diffed" can never drift between them.
 *
 * - `listPrefix` / `listRevs` bracket the list mode flag (`--name-status` / `--numstat`), because the two
 *   forms need different commands: a range is `git diff <mode> <revs…>`, while a **root** commit (no parent
 *   to subtract) is `git show --format= <mode> <sha>`. Compose them with {@link changedFileArgs}.
 * - `untracked`: whether worktree files git doesn't track belong in the change set (they do for anything
 *   ending at the worktree, never for a historical commit).
 * - `originalRef` / `modifiedRef`: the blob sources of the diff's two sides — `null` on `originalRef` means
 *   "nothing there" (a root commit's add-style diff), `null` on `modifiedRef` means the file **on disk**.
 */
export interface DiffRange {
	listPrefix: string[];
	listRevs: string[];
	untracked: boolean;
	originalRef: string | null;
	modifiedRef: string | null;
}

/** A commit id as git prints one — abbreviated or full, sha1 or sha256. Never interpolated unvalidated. */
const OID = /^[0-9a-f]{4,64}$/;

/**
 * The **full commit oid** a ref names right now, or `null` when it names no commit (a deleted ref, an
 * unborn `HEAD`). The one place a symbolic ref is frozen into an immutable one.
 *
 * Everything that must keep meaning the same thing later goes through here: the review's `baseSha`, the
 * blob a base-side comment quotes, the commit Reject restores from. A scope's `originalRef` is *not*
 * already immutable — `uncommitted` resolves to the literal `HEAD`, and a `branch` scope degrades to the
 * raw base ref when `merge-base` fails — so storing one verbatim means the content moves out from under
 * whatever stored it. `--end-of-options` because the ref is repo-controlled text (see `isSafeRef`).
 */
export function resolveCommitOid(worktreePath: string, ref: string): string | null {
	const out = git(worktreePath, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`${ref}^{commit}`,
	]);
	return out.ok && out.out ? out.out : null;
}

/**
 * Resolve a scope against a workspace.
 *
 * A `branch` scope measures "what this workspace changed": it spans from the **merge-base** of the diff
 * base and `HEAD` (the fork point), not from the base's tip — a base that advanced underneath the
 * workspace (a fetch moving `origin/main`, a commit landing on the local base) must not surface upstream
 * work as phantom changes (`D` rows for files this worktree never touched). While the base hasn't
 * diverged, the merge-base *is* its tip, so the range is identical to a plain `git diff <base>`. A failed
 * `merge-base` (missing/deleted base, unrelated histories, unborn `HEAD`) **falls back to the raw ref**,
 * preserving the old behavior exactly where it mattered: a missing base still fails the diff loudly
 * (never reading as "no changes"), unrelated histories still diff against the tip.
 *
 * A `commit` scope is validated twice — shape (`OID`, so a crafted
 * `sha` can never reach a git argument as e.g. an option or a path) and existence (`rev-parse --verify`,
 * whose full oid is what we then use) — and **throws** when the commit is gone (a rebase or branch reset):
 * a `CodedError("UNKNOWN_COMMIT")`, so the panel can turn *that* rejection (and only that one — not a
 * timeout or an unnamed host failure) into "reset the scope, and say so" instead of staying wedged on a dead sha.
 *
 * Existence, deliberately **not** reachability: a commit the branch no longer contains (a rebase rewrote
 * history) is still a meaningful selection whose diff we can show — see the module SPEC.
 */
export function resolveDiffRange(
	ws: Pick<Workspace, "baseBranch" | "diffBase" | "worktreePath">,
	scope: GitDiffScope = { kind: "branch" },
): DiffRange {
	if (scope.kind === "uncommitted") {
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
		};
	}
	if (scope.kind === "pinned") {
		// The review sidebar's base-side navigation: worktree vs one immutable commit. Validated like a
		// `commit` scope (shape, then existence — the anchor's pinned oid can be gone after a prune/gc),
		// with the same coded rejection so the client can say "that commit no longer exists" precisely.
		if (!OID.test(scope.baseRef)) throw new Error(`Not a commit id: ${scope.baseRef}`);
		const resolved = git(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.baseRef}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.baseRef}`);
		return {
			listPrefix: ["diff"],
			listRevs: [resolved.out],
			untracked: true,
			originalRef: resolved.out,
			modifiedRef: null,
		};
	}
	if (scope.kind === "commit") {
		if (!OID.test(scope.sha)) throw new Error(`Not a commit id: ${scope.sha}`);
		const resolved = git(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.sha}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.sha}`);
		const sha = resolved.out;
		const parent = git(ws.worktreePath, ["rev-parse", "--verify", "--quiet", `${sha}^^{commit}`]);
		// A root commit has no `sha^` to subtract: `git show` diffs it against the empty tree, which is the
		// same add-style degradation `gitDiffFile` already uses for a file absent from the original side.
		if (!parent.ok || !parent.out) {
			return {
				listPrefix: ["show", "--format="],
				listRevs: [sha],
				untracked: false,
				originalRef: null,
				modifiedRef: sha,
			};
		}
		return {
			listPrefix: ["diff"],
			listRevs: [parent.out, sha],
			untracked: false,
			originalRef: parent.out,
			modifiedRef: sha,
		};
	}
	const base = diffBaseRef(ws);
	// The fork point (see the function docstring). No trailing `--` here: `merge-base` takes revs only,
	// so a ref that also names a path on disk can't be "ambiguous" the way it is for `diff`.
	const mergeBase = git(ws.worktreePath, ["merge-base", "--end-of-options", base, "HEAD"]);
	const forkPoint = mergeBase.ok && mergeBase.out ? mergeBase.out : base;
	return {
		listPrefix: ["diff"],
		listRevs: [forkPoint],
		untracked: true,
		originalRef: forkPoint,
		modifiedRef: null,
	};
}

/**
 * The argv listing a range's changed files in the given mode (see {@link DiffRange}). The revs are bracketed
 * on **both** sides:
 * - `--end-of-options` ahead of them, so a ref that *looks* like a flag (`--output=…`, reachable from an
 *   untrusted repo — see `isSafeRef`) is refused as a rev instead of parsed as an option;
 * - a trailing **`--`**, so a rev that also names a path on disk (a branch called `docs`, a worktree folder
 *   called `main`) is read as a rev instead of making git bail with "ambiguous argument". Without it that
 *   ambiguity fails the whole command — and a failed diff used to read as *no changes*, i.e. a review
 *   surface calling a dirty worktree clean.
 */
export function changedFileArgs(
	range: DiffRange,
	mode: "--name-status" | "--numstat" | "--shortstat",
): string[] {
	return [...range.listPrefix, mode, "--end-of-options", ...range.listRevs, "--"];
}
