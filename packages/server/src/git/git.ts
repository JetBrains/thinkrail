import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	BranchList,
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitStatus,
	Workspace,
} from "@thinkrail/contracts";
import { loadProjects, loadWorkspaces } from "../persistence";
import {
	changedFileArgs,
	type DiffRange,
	type DiffSide,
	diffBaseRef,
	resolveDiffRange,
} from "./diffScope";
import { BACKGROUND_FETCH_TIMEOUT_MS, git, gitAsync, REMOTE_ENV } from "./gitExec";
import { trackingRefOid } from "./remoteRefs";

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

function lines(out: string): string[] {
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

/**
 * A project repo's branches for the New-Workspace base picker: local (`refs/heads`), remote-tracking under
 * `origin` (minus `origin/HEAD`), and the preselected default — `origin/HEAD`'s target, else `origin/main`,
 * else the repo's current `HEAD` branch. Offline-safe: every step degrades to what git can answer locally.
 */
export function listBranches(projectId: string): BranchList {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	const repo = project.path;

	const local = lines(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).out);
	// `origin/HEAD` (the remote's default-branch pointer) shortens to a bare `origin` and is a *symref* —
	// list `%(symref)` alongside the name and drop any ref that has one, so `origin` never leaks in.
	const remote = lines(
		git(repo, ["for-each-ref", "--format=%(refname:short)\t%(symref)", "refs/remotes/origin"]).out,
	)
		.map((line) => line.split("\t"))
		.filter((parts) => !parts[1])
		.map((parts) => parts[0] ?? "")
		.filter(Boolean);

	return { local, remote, defaultBranch: resolveDefaultBranch(repo) };
}

/**
 * The repo's default branch, resolved from what git knows locally: `origin/HEAD`'s target →
 * `origin/main` → the repo's current `HEAD` branch. Named once — shared by `listBranches` (the base
 * picker's preselection) and the `workspaces` module's Default-workspace ensure (its `baseBranch`).
 */
export function resolveDefaultBranch(repoPath: string): string {
	const head = git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
	if (head.ok && head.out) return head.out;
	if (git(repoPath, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]).ok)
		return "origin/main";
	// Last resort: the checkout's own branch. `currentBranch` answers even on an unborn HEAD (a repo
	// with no commits yet), so the literal "HEAD" never leaks into a persisted, user-visible baseBranch.
	return currentBranch(repoPath);
}

/**
 * The branch a checkout currently has out — `symbolic-ref --short HEAD`, which (unlike `rev-parse
 * --abbrev-ref`) also answers on an unborn HEAD (a repo with no commits yet). Detached HEAD → the
 * literal `"HEAD"`. Used for the Default workspace, whose branch is whatever the project folder has
 * checked out (it moves out-of-band — a terminal `git checkout` — unlike a worktree's pinned branch).
 */
export function currentBranch(repoPath: string): string {
	const head = git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
	return head.ok && head.out ? head.out : "HEAD";
}

/**
 * Best-effort **background** fetch of a remote branch, so a *subsequent* `createWorkspace` branches off a
 * fresh tip without paying the ~2s network round-trip on the create critical path. The New-Workspace dialog
 * fires this when it opens (for the default base) and when a different remote base is picked — the fetch
 * overlaps the time the user spends choosing a branch / typing the prompt, so the create itself stays local
 * and instant. Async (`gitAsync`, never `spawnSync`) so the network fetch can't block the host's event
 * loop; a local (non-`origin/`) ref or an offline/failed fetch is a harmless no-op ack.
 *
 * Runs under `REMOTE_ENV` (no prompt path — see that constant's doc) with a `BACKGROUND_FETCH_TIMEOUT_MS`
 * deadline, exactly like every other background remote call this app makes: without them, this fetch is
 * the one credential-ladder-unlocking operation (`handlers.ts`'s `git.prefetch` grants rung 2 off its
 * success) that could prompt or hang indefinitely.
 *
 * `moved` reports whether the fetch changed which commit the local remote-tracking ref names (its first
 * appearance counts). A moved ref *may* change what a sibling workspace's branch-scope diff means (its
 * merge-base can move), so the `git.prefetch` handler fans the pathless `fsChanged` invalidation out to
 * the workspaces reading that ref (see `host`'s fsNudge seam; the re-read is idempotent when the
 * merge-base stayed put) — `moved` is host-internal and never reaches the wire (the response stays
 * `{ ok }`).
 */
export async function prefetchBranch(
	projectId: string,
	ref: string,
): Promise<{ ok: boolean; moved: boolean }> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project || !ref.startsWith("origin/")) return { ok: false, moved: false };
	// Fully qualified on purpose: the short name resolves by git's DWIM order, where a local branch
	// literally named `origin/<b>` (`refs/heads/origin/<b>`) would shadow the remote-tracking ref — and the
	// fetch updates `refs/remotes/…` regardless, so the comparison must read exactly that. `trackingRefOid`
	// (this module's own `remoteRefs.ts`) is the shared primitive for this read — see its docstring for why
	// it's exported rather than reimplemented per caller.
	const name = ref.slice("origin/".length);
	const before = trackingRefOid(project.path, "origin", name);
	// `--` so a `-`-prefixed branch name can't be parsed by git as an option.
	const result = await gitAsync(project.path, ["fetch", "origin", "--", name], {
		env: REMOTE_ENV,
		timeoutMs: BACKGROUND_FETCH_TIMEOUT_MS,
	});
	if (!result.ok) return { ok: false, moved: false };
	const after = trackingRefOid(project.path, "origin", name);
	const moved = after !== undefined && after !== before;
	return { ok: true, moved };
}

/** Map a `git diff --name-status` code (`M`, `A`, `D`, `R100`, …) to our status enum. */
function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

/**
 * Resolve a `git diff --numstat` path to its final path so it matches `--name-status`'s destination.
 * Rename/copy rows arrive mangled: plain `old => new`, or brace form `pre{old => new}post` →
 * `pre + new + post` (e.g. `src/{a => b}/x.ts` → `src/b/x.ts`).
 */
export function numstatPath(raw: string): string {
	if (!raw.includes("=>")) return raw;
	const brace = raw.match(/^(.*)\{.* => (.*)\}(.*)$/);
	if (brace) return `${brace[1]}${brace[2]}${brace[3]}`.replace(/\/\//g, "/");
	const arrow = raw.match(/ => (.*)$/);
	return arrow ? (arrow[1] ?? raw) : raw;
}

/**
 * Per-file `{added, removed}` over the range, keyed by (resolved) path. Binary rows (`-`/`-`) are skipped.
 * A **failed** command throws (see {@link diffFailure}) rather than yielding an empty map: counts silently
 * missing from every row is the same lie as a missing row.
 */
function numstat(
	worktreePath: string,
	range: DiffRange,
): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	const out = git(worktreePath, changedFileArgs(range, "--numstat"));
	if (!out.ok) throw diffFailure(out.err);
	if (!out.out) return counts;
	for (const line of out.out.split("\n")) {
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const added = Number(parts[0]);
		const removed = Number(parts[1]);
		if (!Number.isFinite(added) || !Number.isFinite(removed)) continue; // binary: "-" / "-"
		counts.set(numstatPath(parts.slice(2).join("\t")), { added, removed });
	}
	return counts;
}

/** Count a file's lines the way git counts additions (final line without a trailing newline still counts). */
function lineCount(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

// An untracked file's whole content counts as added (it never shows in `git diff`), but bounded: a file
// over this size, or one that looks binary (a NUL byte in its head), gets NO count — matching how tracked
// binaries drop out of `--numstat` (`-`/`-`). This also keeps a large untracked artifact (build output,
// archive) from being re-read into memory on every `git.status` tick.
const UNTRACKED_COUNT_MAX_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/** Added-line count for an untracked file, or `undefined` when it's too large or looks binary. */
function untrackedAdded(worktreePath: string, path: string): number | undefined {
	try {
		const abs = resolve(worktreePath, path);
		if (statSync(abs).size > UNTRACKED_COUNT_MAX_BYTES) return undefined;
		const buf = readFileSync(abs);
		if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return undefined; // NUL byte → treat as binary
		return lineCount(buf.toString("utf8"));
	} catch {
		// unreadable (a dir entry, perms, a race) → no count
		return undefined;
	}
}

/**
 * A **failed** `git diff`/`git show` is an error, never an empty change set. Reporting "no changes" because
 * the command didn't run is the worst failure a review surface can have — so the exit code is honoured and
 * the caller (the panel) keeps its last good list and says the refresh failed.
 */
function diffFailure(stderr: string): Error {
	return new Error(`Could not read the changed files: ${stderr || "git failed"}`);
}

/**
 * A worktree's changed files over the given {@link GitDiffScope} (default: the branch scope — what the
 * workspace changed since diverging from its diff base),
 * plus any untracked files when the range ends at the worktree. Each carries `+/−` counts. Throws for a
 * scope naming a commit that no longer exists (see `resolveDiffRange`) — and for a diff that **failed**,
 * which must never be reported as a clean worktree.
 */
export function gitStatus(workspaceId: string, scope?: GitDiffScope): GitStatus {
	const ws = workspace(workspaceId);
	const range = resolveDiffRange(ws, scope);
	const changes: GitFileChange[] = [];
	const counts = numstat(ws.worktreePath, range);

	const tracked = git(ws.worktreePath, changedFileArgs(range, "--name-status"));
	if (!tracked.ok) throw diffFailure(tracked.err);
	if (tracked.out) {
		// An unmerged (conflicted) path can print TWICE: git's `diff-files` reports it as two separate
		// 2-way comparisons rather than collapsing the 3-way conflict into one row — a generic `U` marker
		// (zero-value, no real diff) always first, then — when a stage-2 ("ours") blob exists to compare
		// against the worktree — a second row carrying the real status/counts (verified against real git
		// 2.50.1: a deleted-by-us conflict, which has no stage 2, prints only the `U` row; a content or
		// add/add conflict, which has one, prints `U` then that real row). Keyed by path so the LAST row
		// wins: the substantive comparison when there is one, the sole `U` row when there isn't — never
		// both, which would double the file in the Changes list and its React `key`.
		const byPath = new Map<string, GitFileChange>();
		for (const line of tracked.out.split("\n")) {
			const parts = line.split("\t");
			const code = parts[0] ?? "";
			// Renames/copies have a third field (old → new); take the destination path.
			const path = parts.length > 2 ? parts[parts.length - 1] : parts[1];
			if (path) byPath.set(path, { path, status: mapStatus(code), ...counts.get(path) });
		}
		changes.push(...byPath.values());
	}

	// Untracked files belong to a range that ends at the worktree (branch/working-tree), never to a historical
	// commit — they are not "in" it.
	if (range.untracked) {
		const untracked = git(ws.worktreePath, ["ls-files", "--others", "--exclude-standard"]);
		if (untracked.ok && untracked.out) {
			for (const path of untracked.out.split("\n")) {
				if (!path) continue;
				const added = untrackedAdded(ws.worktreePath, path);
				// Countable (small text) → whole content added, nothing removed. Binary/oversized → no counts at
				// all, matching the tracked-binary rows `--numstat` drops (and satisfying `exactOptionalPropertyTypes`).
				changes.push({
					path,
					status: "untracked",
					...(added !== undefined && { added, removed: 0 }),
				});
			}
		}
	}

	changes.sort((a, b) => a.path.localeCompare(b.path));
	// The Default workspace's branch is folder-truth that moves out-of-band (a terminal `git checkout`);
	// the persisted snapshot self-heals only at list time, so the Changes header reads it live.
	return { branch: ws.kind === "default" ? currentBranch(ws.worktreePath) : ws.branch, changes };
}

/**
 * Whether a `git show`/`git show :<path>` failure is an **expected** absence — the path genuinely isn't
 * there on this side — rather than a broken read (index-lock contention, a bad/removed ref, repo
 * corruption) that must stay visible via `console.warn`. The single definition shared by {@link showBlob}
 * (a ref side) and {@link showIndexBlob} (the index side), so the two can never drift into two regexes for
 * one concept.
 *
 * Every message below was captured verbatim from real git 2.50.1, and every one prints a lowercase `path` —
 * a case-sensitive match is enough. Git *does* capitalise "Path" elsewhere (`git rm`'s "Path '%s' unmerged;
 * will not remove…"), but that family belongs to `git rm`/`checkout`, which neither `showBlob` nor
 * `showIndexBlob` ever runs, so it can't reach here; there is no capitalised counterpart for these:
 *   - `path '<p>' does not exist in '<ref>'`                         — a ref side, never existed there
 *   - `path '<p>' exists on disk, but not in '<ref>'`                 — a ref side, exists only on disk
 *   - `path '<p>' does not exist (neither on disk nor in the index)`  — the index side, a staged deletion
 *   - `path '<p>' exists on disk, but not in the index`               — the index side, never staged
 *   - `path '<p>' is in the index, but not at stage <N>`              — the queried stage isn't present for
 *     this unmerged path. `<N>` is whichever stage the caller just asked for, not always 0: `showIndexBlob`'s
 *     stage-2 retry (see there) asks for stage 2 ("ours"), and a modify/delete conflict where *we* deleted
 *     the file has no stage 2 either, so that retry can fail with literally "...not at stage 2" (verified
 *     against real git 2.50.1) — still an expected shape of failure, not a broken read. The stage-0 shape of
 *     this same message never reaches this predicate: `showIndexBlob`'s own `UNMERGED_AT_STAGE_ZERO` check
 *     intercepts it first, before falling back to stage 2, so in practice this clause only ever fires for
 *     that retry's own failure.
 */
function isExpectedAbsence(stderr: string): boolean {
	return /does not exist|exists on disk, but not in|is in the index, but not at stage \d/.test(
		stderr,
	);
}

/**
 * One file's content at a ref (`git show ref:path`, byte-exact), or `""` when the path simply isn't there.
 * A path absent from a ref is the intended empty side (an added file has no original; a deleted one has no
 * modified). Any *other* failure — index-lock contention, an invalid/removed ref, repo corruption — would
 * otherwise masquerade as a whole-file add/delete, so it's logged: the broken read stays visible.
 */
function showBlob(worktreePath: string, ref: string, path: string): string {
	// `--end-of-options`: `<ref>:<path>` starts with a repo-controlled ref, which must never be re-parsed
	// as a git option (see `isSafeRef`).
	const shown = git(worktreePath, ["show", "--end-of-options", `${ref}:${path}`], { raw: true });
	if (shown.ok) return shown.out;
	if (!isExpectedAbsence(shown.err)) {
		console.warn(`git show ${ref}:${path} failed: ${shown.err || "unknown error"}`);
	}
	return "";
}

/**
 * Both sides of one changed file over the given {@link GitDiffScope} (default: the branch scope — since
 * diverging from the diff base), for the center Monaco diff tab: `original` = the file at the range's start (empty when it doesn't
 * exist there — untracked/added, a renamed file's new path, or a root commit — which degrades to an
 * add-style diff), `modified` = the file at its end: the worktree (empty when deleted) for a range ending
 * there, else the commit's own tree.
 */
export function gitDiffFile(
	workspaceId: string,
	path: string,
	scope?: GitDiffScope,
): { original: string; modified: string } {
	const ws = workspace(workspaceId);
	const range = resolveDiffRange(ws, scope);

	const abs = resolve(ws.worktreePath, path);
	const rel = relative(ws.worktreePath, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");

	return {
		original: readSide(ws.worktreePath, range.original, path, abs),
		modified: readSide(ws.worktreePath, range.modified, path, abs),
	};
}

/**
 * One side of a diff as text. `empty` is the intended blank side (an added file has no original, a deleted
 * one has no modified); `worktree` reads the file on disk; `index` reads stage 0. An unreadable worktree
 * file degrades to empty — the file is genuinely not there for this side.
 */
function readSide(worktreePath: string, side: DiffSide, path: string, abs: string): string {
	switch (side.kind) {
		case "empty":
			return "";
		case "ref":
			return showBlob(worktreePath, side.ref, path);
		case "index":
			return showIndexBlob(worktreePath, path);
		case "worktree":
			try {
				return readFileSync(abs, "utf8");
			} catch {
				return "";
			}
	}
}

/**
 * `git show`'s message for a path that is in the index but unmerged, specifically at stage 0 — the initial
 * read `showIndexBlob` always attempts. Deliberately narrower than {@link isExpectedAbsence}'s general
 * "not at stage `<N>`" clause: this one names the literal digit `0` because the read it guards always asks
 * for stage 0, so it can decide "retry at stage 2" precisely — a generic `\d` here would also fire for a
 * stage-2 failure that has nothing to do with the initial read.
 */
const UNMERGED_AT_STAGE_ZERO = /is in the index, but not at stage 0/;

/**
 * One file's **staged** content (`git show :<path>` — stage 0), byte-exact, or `""` when the path isn't in
 * the index — a staged deletion (`git rm`), or a path never staged at all — read silently, without a
 * warning (see {@link isExpectedAbsence}). Separate from {@link showBlob} because there is no ref to
 * bracket: the argument is a pathspec-shaped `:<path>`, and passing it through the ref path would read as
 * `":" + ":" + path`.
 *
 * A path **mid-conflict** (an unmerged index entry from a live `merge`/`rebase`/`cherry-pick`) has no stage
 * 0 at all — `git show :<path>` fails with "is in the index, but not at stage 0" — so it falls back to
 * stage 2 ("ours"), the closest honest stand-in for "what the index holds right now". Accepting the stage-0
 * failure as empty would render the file as a whole-file addition (`working-tree` scope: an empty index
 * side against a real worktree) or a whole-file deletion (`staged` scope: a real `HEAD` against an empty
 * index side) — both false claims on a surface whose one job is to never lie about the working tree. A path
 * absent even from stage 2 (e.g. a modify/delete conflict where *we* deleted it) has genuinely nothing on
 * our side — `git show :2:<path>` fails with "is in the index, but not at stage 2" (verified against real
 * git 2.50.1) — which {@link isExpectedAbsence}'s general "not at stage `<N>`" clause recognises as an
 * expected absence too, so that retry's own failure degrades to an empty side silently, not a warning.
 */
function showIndexBlob(worktreePath: string, path: string): string {
	const shown = git(worktreePath, ["show", "--end-of-options", `:${path}`], { raw: true });
	if (shown.ok) return shown.out;
	if (UNMERGED_AT_STAGE_ZERO.test(shown.err)) {
		const ours = git(worktreePath, ["show", "--end-of-options", `:2:${path}`], { raw: true });
		if (ours.ok) return ours.out;
		if (!isExpectedAbsence(ours.err)) {
			console.warn(`git show :2:${path} failed: ${ours.err || "unknown error"}`);
		}
		return "";
	}
	if (!isExpectedAbsence(shown.err)) {
		console.warn(`git show :${path} failed: ${shown.err || "unknown error"}`);
	}
	return "";
}

/** How many commits the scope menu's list can hold — a long-lived branch must not ship its whole history. */
const COMMIT_LIST_MAX = 200;
/**
 * Field separator for the `git log` format: a **NUL byte**, the one byte repository-controlled text cannot
 * smuggle in. An author ident carries neither NUL nor newline (git's ident parser refuses both), so the
 * record framing — fields split on NUL, records split on newline — holds no matter what a repo puts in a
 * name; a `%s` *could* in principle carry a NUL, which costs nothing because the subject is the record's
 * **tail**: everything past the fixed leading fields is joined back together.
 *
 * A previous version used `\u001f` and claimed "structured fields first" made it safe. It didn't: `%an` is
 * free text too and sits *between* the structured fields and the subject, so an author named
 * `a\u001f2020-01-01T00:00:00Z` shifted the subject one field over and truncated the author. Fixed arity +
 * a separator the text can't contain is what actually makes the framing unambiguous.
 */
const LOG_SEP = "\u0000";

/** How many leading `--format` fields are structured; everything after them is one free-text tail. */
const LOG_LEADING_FIELDS = 4;

/**
 * Repository-controlled text, made safe to render: control characters (the framing bytes included) plus the
 * **invisible** troublemakers — bidi overrides/embeddings (which can make a subject render right-to-left and
 * disguise what a commit says) and zero-width/format characters (which hide inside a name). Everything else,
 * emoji and scripts alike, is kept: this strips deception, not internationalization.
 */
function plainText(raw: string): string {
	let out = "";
	for (const char of raw) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) continue; // C0 controls + DEL
		if (code >= 0x80 && code <= 0x9f) continue; // C1 controls
		if (code >= 0x200b && code <= 0x200f) continue; // zero-width + LRM/RLM
		if (code >= 0x202a && code <= 0x202e) continue; // bidi embeddings/overrides
		if (code >= 0x2066 && code <= 0x2069) continue; // bidi isolates
		if (code === 0x061c) continue; // Arabic letter mark
		if (code === 0xfeff) continue; // BOM / zero-width no-break space
		if (code === 0x00ad) continue; // soft hyphen
		out += char;
	}
	return out;
}

/**
 * The commits **on this workspace's branch** that its diff base doesn't have (`git log <base>..HEAD`),
 * newest first and capped — the scope menu's commit rows. An unreadable range (a base branch that was
 * deleted, an unborn HEAD) degrades to an empty list: the menu still offers its other scopes.
 */
export function listCommits(workspaceId: string): { commits: GitCommit[] } {
	const ws = workspace(workspaceId);
	const log = git(ws.worktreePath, [
		"log",
		`--max-count=${COMMIT_LIST_MAX}`,
		// NUL-separated fields of fixed arity, the free-text subject last (see LOG_SEP), and `--end-of-options`
		// so the range's base ref can't be parsed as an option.
		`--format=%H%x00%h%x00%cI%x00%an%x00%s`,
		"--end-of-options",
		`${diffBaseRef(ws)}..HEAD`,
		"--",
	]);
	if (!log.ok || !log.out) return { commits: [] };
	const commits: GitCommit[] = [];
	for (const line of log.out.split("\n")) {
		const parts = line.split(LOG_SEP);
		const [sha, shortSha, committedAt, author] = parts;
		if (!sha || !shortSha) continue;
		// Everything past the fixed leading fields is the subject, separators and all — so nothing a repo can put
		// in the free-text fields can shift `author`/`committedAt`.
		const subject = parts.slice(LOG_LEADING_FIELDS).join(LOG_SEP);
		commits.push({
			sha,
			shortSha,
			subject: plainText(subject),
			author: plainText(author ?? ""),
			committedAt: committedAt ?? "",
		});
	}
	return { commits };
}
