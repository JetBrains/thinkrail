import { readFileSync, realpathSync, statSync } from "node:fs";
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
import { changedFileArgs, type DiffRange, diffBaseRef, resolveDiffRange } from "./diffScope";
import { git, gitAsync } from "./gitExec";

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
 * The comparable form of a path. **Git reports symlink-resolved paths** (`--show-toplevel`, `worktree
 * list`) while a path we were handed keeps whatever symlinks the caller wrote (macOS's `/var` →
 * `private/var`), so comparing either side raw mismatches silently. An unreadable path degrades to
 * `resolve` — a missing dir still compares by name instead of throwing.
 */
export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/**
 * Fallibly read the branch a checkout currently has out. A valid detached checkout is the literal
 * `"HEAD"`; an unreadable/non-worktree root is `null`, so callers that persist folder truth never turn an
 * I/O failure into a fake detach. `symbolic-ref` also answers on an unborn branch.
 */
export function tryCurrentBranch(repoPath: string): string | null {
	const head = git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
	if (head.ok && head.out) return head.out;
	const topLevel = git(repoPath, ["rev-parse", "--show-toplevel"]);
	return topLevel.ok && canonicalPath(topLevel.out) === canonicalPath(repoPath) ? "HEAD" : null;
}

/**
 * Compatibility read for callers that already established a valid checkout. Detached (or unreadable)
 * paths degrade to `"HEAD"`; persistence refreshes use `tryCurrentBranch` instead.
 */
export function currentBranch(repoPath: string): string {
	return tryCurrentBranch(repoPath) ?? "HEAD";
}

/**
 * Best-effort **background** fetch of a remote branch, so a *subsequent* `createWorkspace` branches off a
 * fresh tip without paying the ~2s network round-trip on the create critical path. The New-Workspace dialog
 * fires this when it opens (for the default base) and when a different remote base is picked — the fetch
 * overlaps the time the user spends choosing a branch / typing the prompt, so the create itself stays local
 * and instant. Async (`gitAsync`, never `spawnSync`) so the network fetch can't block the host's event
 * loop; a local (non-`origin/`) ref or an offline/failed fetch is a harmless no-op ack.
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
	// fetch updates `refs/remotes/…` regardless, so the comparison must read exactly that.
	const revParse = () =>
		git(project.path, [
			"rev-parse",
			"--verify",
			"--quiet",
			"--end-of-options",
			`refs/remotes/${ref}`,
		]);
	const before = revParse();
	// `--` so a `-`-prefixed branch name can't be parsed by git as an option.
	const result = await gitAsync(project.path, [
		"fetch",
		"origin",
		"--",
		ref.slice("origin/".length),
	]);
	if (!result.ok) return { ok: false, moved: false };
	const after = revParse();
	const moved = after.ok && after.out !== "" && (!before.ok || before.out !== after.out);
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
		for (const line of tracked.out.split("\n")) {
			const parts = line.split("\t");
			const code = parts[0] ?? "";
			// Renames/copies have a third field (old → new); take the destination path.
			const path = parts.length > 2 ? parts[parts.length - 1] : parts[1];
			if (path) changes.push({ path, status: mapStatus(code), ...counts.get(path) });
		}
	}

	// Untracked files belong to a range that ends at the worktree (branch/uncommitted), never to a historical
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
	// User-owned workspaces can switch branches out-of-band; the Changes header reads folder truth live
	// while their persisted snapshot converges through the metadata nudge/list path.
	const branch =
		ws.kind === "default" || ws.kind === "external" ? currentBranch(ws.worktreePath) : ws.branch;
	return { branch, changes };
}

/**
 * One file's content at a ref (`git show ref:path`, byte-exact), or `null` when the read didn't produce
 * one. Any failure — a path the ref simply doesn't have, index-lock contention, an invalid/removed ref,
 * repo corruption — is logged unless it's the ordinary "not in that ref", so a broken read stays visible
 * instead of masquerading as an empty file.
 */
export function readBlobAt(worktreePath: string, ref: string, path: string): string | null {
	// `--end-of-options`: `<ref>:<path>` starts with a repo-controlled ref, which must never be re-parsed
	// as a git option (see `isSafeRef`).
	const shown = git(worktreePath, ["show", "--end-of-options", `${ref}:${path}`], { raw: true });
	if (shown.ok) return shown.out;
	if (!/does not exist in|exists on disk, but not in/.test(shown.err)) {
		console.warn(`git show ${ref}:${path} failed: ${shown.err || "unknown error"}`);
	}
	return null;
}

/**
 * `readBlobAt` for the diff sides: a path absent from a ref is the intended EMPTY side (an added file has
 * no original; a deleted one has no modified), so the diff degrades to add/delete style rather than failing.
 */
function showBlob(worktreePath: string, ref: string, path: string): string {
	return readBlobAt(worktreePath, ref, path) ?? "";
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

	const original = range.originalRef ? showBlob(ws.worktreePath, range.originalRef, path) : "";

	if (range.modifiedRef)
		return { original, modified: showBlob(ws.worktreePath, range.modifiedRef, path) };
	let modified = "";
	try {
		modified = readFileSync(abs, "utf8");
	} catch {
		// deleted (or unreadable) in the worktree → empty modified side
	}
	return { original, modified };
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
