import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DiffStats, Project, Workspace } from "@thinkrail/contracts";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	assertSafeRef,
	changedFileArgs,
	currentBranch,
	git,
	gitAsync,
	resolveDefaultBranch,
	resolveDiffRange,
} from "../git";
import { dataDir, loadProjects, loadWorkspaces, saveWorkspaces } from "../persistence";
import { getProjects, listProjects } from "../projects";

/**
 * A workspace-registry membership change, emitted on every create/rename/archive so the host can fan it
 * out to every client (architecture #9 — registry membership is shared domain state). The module stays
 * ignorant of WS channels: it emits a domain event; `createServer` maps `kind` → `workspace.*` channel.
 * `created`/`updated` carry the full record; `removed` carries only the ids (the record is already gone).
 */
export type WorkspaceLifecycleEvent =
	| { kind: "created"; workspace: Workspace }
	| { kind: "updated"; workspace: Workspace }
	| { kind: "removed"; projectId: string; id: string };

type WorkspacePublisher = (event: WorkspaceLifecycleEvent) => void;

// Injected by the host (the same publisher inversion `terminal`/`agent`/`auth` use). `null` in unit tests
// / the e2e reset → emits are silent no-ops, so the pure record functions stay testable in isolation.
let publishLifecycle: WorkspacePublisher | null = null;

/** Install (or clear with `null`) the sink the workspace lifecycle events are fanned out through. */
export function setWorkspacePublisher(fn: WorkspacePublisher | null): void {
	publishLifecycle = fn;
}

function emit(event: WorkspaceLifecycleEvent): void {
	publishLifecycle?.(event);
}

function toBranch(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "workspace"
	);
}

/** Longest display name we store — keeps the left-nav readable; the branch is derived from it. */
const MAX_DISPLAY_NAME = 60;

/**
 * Sanitize a requested **display name** for storage: trim, collapse whitespace, clamp length — casing and
 * punctuation preserved (unlike `toBranch`). `null` if nothing usable remains. The stored `Workspace.name`
 * is display-only; its git branch is derived separately via `toBranch`.
 */
function toDisplayName(raw: string): string | null {
	const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME).trimEnd();
	return name.length > 0 ? name : null;
}

function branchExists(repoPath: string, branch: string): boolean {
	return git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

/**
 * Whether a candidate branch name is unusable for this project: the branch exists (archiving leaves
 * branches behind), or its would-be worktree directory is occupied (a rename frees the branch name but
 * the worktree dir stays where it was — `worktreePath` never moves).
 */
function nameTaken(project: Project, candidate: string): boolean {
	return (
		branchExists(project.path, candidate) ||
		existsSync(join(dataDir(), "worktrees", project.slug, candidate))
	);
}

/** A usable branch name — `base`, else `base-2`, `base-3`, … (free as a ref *and* as a worktree dir). */
function uniqueBranch(project: Project, base: string): string {
	if (!nameTaken(project, base)) return base;
	let n = 2;
	while (nameTaken(project, `${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

/** First free `workspace-N` (free as a ref *and* as a worktree dir). */
function nextAutoBranch(project: Project): string {
	let n = 1;
	while (nameTaken(project, `workspace-${n}`)) n += 1;
	return `workspace-${n}`;
}

/**
 * The **Default workspace's** folder-truth fields, read from the project folder itself: `branch` = what it
 * has checked out, `baseBranch` = the repo's default branch. Both move out-of-band (a terminal `git
 * switch`), so they are re-read — never trusted from the record — by both sync paths below. Two sync git
 * spawns: callers read them BEFORE loading the registry snapshot they intend to save (see the call sites).
 */
function folderTruth(repoPath: string): { branch: string; baseBranch: string } {
	return { branch: currentBranch(repoPath), baseBranch: resolveDefaultBranch(repoPath) };
}

/** Write folder-truth onto a record; `true` when it actually drifted (i.e. a save + `updated` is due). */
function applyFolderTruth(ws: Workspace, truth: { branch: string; baseBranch: string }): boolean {
	if (ws.branch === truth.branch && ws.baseBranch === truth.baseBranch) return false;
	ws.branch = truth.branch;
	ws.baseBranch = truth.baseBranch;
	return true;
}

/**
 * Working-tree changes of a worktree over its **branch scope** — the same range the Changes panel shows
 * (the git module's resolver: merge-base of the diff base and `HEAD`, so upstream commits never inflate
 * the badge), composed through `changedFileArgs` so the counts can't disagree with the file list.
 * `undefined` when git couldn't answer — **not** `{0,0}`: a failed diff read as "clean" is how a dirty
 * worktree ends up wearing no badge, so the unknown is left unknown (the rail then shows no badge, as it does
 * for a genuinely clean worktree, but nothing claims a count it doesn't have) and the reason is logged.
 */
function diffStats(ws: Workspace): DiffStats | undefined {
	const result = git(ws.worktreePath, changedFileArgs(resolveDiffRange(ws), "--shortstat"));
	if (!result.ok) {
		console.warn(
			`git diff --shortstat failed in ${ws.worktreePath}: ${result.err || "unknown error"}`,
		);
		return undefined;
	}
	if (!result.out) return { added: 0, removed: 0 };
	return {
		added: Number(/(\d+) insertion/.exec(result.out)?.[1] ?? 0),
		removed: Number(/(\d+) deletion/.exec(result.out)?.[1] ?? 0),
	};
}

/**
 * Create a workspace = a `git worktree` on its own fresh branch, under the data dir. `baseRef` is the base
 * the branch is cut from (the New-Workspace picker): `worktree add -b <branch> <baseRef>` cuts a *local*
 * branch from it — never a detached remote checkout. Omitted → branch off the repo's current `HEAD`.
 *
 * Freshness for a remote ref (`origin/<b>`) is kept off this critical path: the New-Workspace dialog
 * `prefetchBranch`es it in the background when it opens, so the local remote-tracking ref is already
 * current by the time we branch. We only fetch *here* as a cheap fallback when the ref isn't present
 * locally at all (never fetched) — a ~10ms `rev-parse` guard, so the common case pays no network cost.
 */
export async function createWorkspace(
	projectId: string,
	name?: string,
	baseRef?: string,
): Promise<Workspace> {
	// `listProjects` (open only) — a closed project must reject creation even from a stale or rogue client
	// that still names it (the rail can't offer the "+" once closed, but the request can still arrive).
	const project = listProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);

	// A user-supplied name is the display name (casing/punctuation preserved); the branch is derived from
	// it. Omitted (or unusable) → the auto `workspace-N` placeholder, where name === branch.
	const displayName = name ? toDisplayName(name) : null;
	const branch = displayName
		? uniqueBranch(project, toBranch(displayName))
		: nextAutoBranch(project);
	const wsName = displayName ?? branch;

	const base = baseRef?.trim();
	let baseBranch: string;
	if (base) baseBranch = base;
	else {
		const head = git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
		baseBranch = head.ok ? head.out : "HEAD";
	}
	// The base reaches `git worktree add` (and, below, `git fetch`) as a rev, so it is validated — and the
	// **resolved** value is what gets validated, not just a client-supplied one: the fallback comes from
	// `rev-parse --abbrev-ref HEAD`, i.e. from the repository, and an untrusted repo can have an
	// option-shaped branch (`--output=…`) checked out just as it can offer one in the picker (see `isSafeRef`).
	// Both halves of the same door: whichever way the base is chosen, it passes the same check.
	assertSafeRef(baseBranch);
	// Fallback fetch only when the remote-tracking ref is missing locally, so `worktree add` can't fail on
	// an unknown ref (the freshness fetch already happened in the background via `prefetchBranch`). The
	// `rev-parse` guard is ~10ms; offline it degrades to whatever ref exists locally. Async (`gitAsync`) so
	// the network round-trip can't block the event loop; `--` guards against `-`-prefixed branch names.
	if (
		baseBranch.startsWith("origin/") &&
		!git(project.path, ["rev-parse", "--verify", "--quiet", baseBranch]).ok
	) {
		await gitAsync(project.path, ["fetch", "origin", "--", baseBranch.slice("origin/".length)]);
	}

	const worktreePath = join(dataDir(), "worktrees", project.slug, branch);
	mkdirSync(dirname(worktreePath), { recursive: true });
	const added = git(project.path, [
		"worktree",
		"add",
		worktreePath,
		"-b",
		branch,
		"--end-of-options",
		baseBranch,
	]);
	if (!added.ok) throw new Error(`git worktree add failed: ${added.err}`);

	const workspace: Workspace = {
		id: randomUUID(),
		projectId,
		name: wsName,
		branch,
		worktreePath,
		baseBranch,
		// A user-chosen name is a deliberate one — the auto-namer must never touch it. Auto `workspace-N`
		// leaves the flag unset: eligible for one assist rename.
		...(displayName ? { renamed: true } : {}),
	};
	ensureWorkspaceScratchDir(workspace);
	// Load the registry only now — after the awaited fallback fetch. A concurrent `workspace.list` may
	// have written meanwhile (materializing/refreshing the Default); appending to a pre-await snapshot
	// would clobber that write (same discipline as renameWorkspace's re-load after its git subprocess).
	const all = loadWorkspaces();
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

/**
 * Idempotently seed a workspace's ephemeral scratch dir (`WORKSPACE_CONTEXT_DIR`) for temp docs
 * (task-specs / working files). Its `.gitignore` is a lone `*` — which matches the `.gitignore`
 * itself — so the whole dir has zero git footprint yet stays scannable by the spec tools (they ignore
 * only node_modules/.git/dist/build, not .gitignore). Worktree creation seeds eagerly; the host also
 * calls this on session create, which is what seeds the **Default** workspace — merely listing or
 * entering it must never write into the user's repo, starting a chat there may.
 *
 * Hardened — in the Default workspace this runs against **repository-controlled content** inside the
 * user's own repo:
 * - The workspace root must already exist: an externally-deleted worktree must fail the session loudly,
 *   not be silently resurrected as an empty non-git directory.
 * - Owned path components are walked with `lstat` (never followed) — a malicious checkout can't symlink
 *   `.thinkrail`/`context` and redirect the seed outside the workspace.
 * - The `.gitignore` is an **exclusive create** (`wx`): a pre-existing (possibly tracked, possibly
 *   customized) file is the user's — never clobbered — and `O_EXCL` refuses to follow a (possibly
 *   dangling) symlink, so the file lands only on a truly vacant path.
 */
export function ensureWorkspaceScratchDir(ws: Workspace): void {
	if (!statSync(ws.worktreePath, { throwIfNoEntry: false })?.isDirectory())
		throw new Error(`Workspace directory is missing: ${ws.worktreePath}`);
	let dir = ws.worktreePath;
	for (const part of WORKSPACE_CONTEXT_DIR.split("/")) {
		dir = join(dir, part);
		const entry = lstatSync(dir, { throwIfNoEntry: false });
		if (!entry) mkdirSync(dir);
		else if (!entry.isDirectory())
			throw new Error(`Refusing to seed the scratch dir: not a real directory: ${dir}`);
	}
	try {
		writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
	}
}

/**
 * Ensure the project's built-in **Default workspace** (`kind: "default"`) — the project folder itself
 * (git's main working tree) surfaced as a workspace. Exactly one per project: find-or-create keyed by
 * `projectId` + `kind` (the id is a plain `randomUUID` — the `kind` field is the marker, never an id
 * convention), collapsing duplicates defensively if out-of-band state churn ever produced two (keep
 * the oldest, emit `removed` for the rest so clients converge). No `git worktree add` (the folder
 * already is a working tree) and no scratch-dir seeding (see `ensureWorkspaceScratchDir`).
 *
 * Fields are folder-truth: `branch` = whatever the folder has checked out, `baseBranch` = the repo's
 * default branch — both refreshed when they drifted out-of-band, **emitting `updated`** so every
 * client's rail converges (a terminal `git checkout` must not leave another tab stale; rename uses the
 * same channel for the same fields, and the store's merge triggers no re-list, so no feedback loop).
 * Every emit happens **after** the save — persist-then-publish, like every other mutation path.
 * `renamed: true` keeps the auto-rename passes away, belt-and-suspenders on
 * top of the hard guards in `renameWorkspace`/`forgetWorkspace`.
 */
function ensureDefaultWorkspace(project: Project): Workspace {
	// Folder-truth FIRST: these are sync git spawns that block the JS thread, and another process can
	// rewrite workspaces.json while we sit in them (see `renameWorkspace` below — the e2e reset does
	// exactly that). Loading after them keeps load→mutate→save one uninterrupted synchronous block.
	const truth = folderTruth(project.path);
	const { branch, baseBranch } = truth;
	const all = loadWorkspaces();
	const defaults = all.filter((w) => w.projectId === project.id && w.kind === "default");

	const existing = defaults[0];
	if (existing) {
		const extras = defaults.slice(1);
		if (extras.length > 0) {
			// Duplicates are corruption (the ensure is the only writer) — collapse to the oldest record.
			const keep = all.filter((w) => !extras.includes(w));
			all.length = 0;
			all.push(...keep);
		}
		const drifted = applyFolderTruth(existing, truth);
		if (extras.length > 0 || drifted) saveWorkspaces(all);
		// Persist-then-publish: a failed save must not tear down (or update) records still on disk.
		for (const extra of extras) emit({ kind: "removed", projectId: project.id, id: extra.id });
		if (drifted) emit({ kind: "updated", workspace: existing });
		return existing;
	}

	const workspace: Workspace = {
		id: randomUUID(),
		projectId: project.id,
		kind: "default",
		name: "Default",
		branch,
		worktreePath: project.path,
		baseBranch,
		renamed: true,
	};
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

/**
 * Re-sync one **Default workspace** record against folder-truth and publish it when it drifted — the
 * *live* half of the ensure above, off the `workspace.list` path: cheap (two `symbolic-ref`-class git
 * reads, **no** diff-stat listing) so the host can call it on `watch`'s debounced **repo-metadata nudge**
 * (a `.git` write in the worktree). A `git switch` in the Default terminal therefore converges the rail,
 * the top bar and the empty receipt in every client — including a switch that leaves the working tree
 * byte-identical — instead of leaving them on the old branch until a manual project reload.
 * Unknown id / a worktree workspace (its branch is pinned) / no drift → a no-op, no save, no emit.
 */
export function refreshDefaultWorkspace(workspaceId: string): void {
	// A peek decides whether this id is even a Default (only those drift) — nothing is mutated from it.
	const peek = loadWorkspaces().find((w) => w.id === workspaceId);
	if (peek?.kind !== "default") return;
	// Folder-truth, THEN the snapshot we mutate: the git reads block the JS thread and another process can
	// rewrite workspaces.json meanwhile, so load→mutate→save stays one uninterrupted block (as above).
	const truth = folderTruth(peek.worktreePath);
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === workspaceId);
	if (ws?.kind !== "default") return;
	if (!applyFolderTruth(ws, truth)) return;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
}

/**
 * Rename a workspace: its **display name** and its **git branch** (derived from the name), in place. The
 * name carries the human label (casing/punctuation preserved); the branch is `toBranch(name)`, made unique
 * (refs + worktree dirs) — so `name` and `branch` deliberately differ (e.g. `Fix Auth Redirect` /
 * `fix-auth-redirect`). The branch ref moves via `git branch -m` from the project repo (the worktree's
 * HEAD follows); the worktree directory never moves — pi keys sessions by exact cwd, and terminals/tabs are
 * rooted there, so the dir keeps its creation name. Re-points sibling records that based their diff on the
 * old branch, and emits `updated` for **every** record it changed (the target plus those siblings), so no
 * client is left with a stale `vs <old branch>` label. Sync on purpose: a caller's check-then-rename can't interleave on the event loop. Throws on
 * unknown id / git failure / an empty requested name.
 *
 * `lock` (default `true`) sets `renamed`, marking the name deliberate so the auto-namer never touches it
 * again — what a user rename and the agentic auto-rename want. The **provisional naive rename** passes
 * `lock: false`: it renames name + branch but leaves `renamed` unset, so the settled-turn agentic pass
 * still refines the slug into a final name and locks it then.
 */
export function renameWorkspace(
	id: string,
	requestedName: string,
	opts: { lock?: boolean } = {},
): Workspace {
	const lock = opts.lock ?? true;
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const project = getProjects().find((p) => p.id === ws.projectId);
	if (!project) throw new Error(`Unknown project: ${ws.projectId}`);

	// The Default workspace's branch is the user's real branch — renaming would `git branch -m` it.
	if (ws.kind === "default") throw new Error("The Default workspace cannot be renamed");
	const displayName = toDisplayName(requestedName);
	if (!displayName) throw new Error(`Invalid workspace name: ${requestedName}`);
	const wanted = toBranch(displayName);
	const branch = wanted === ws.branch ? ws.branch : uniqueBranch(project, wanted);
	if (branch !== ws.branch) {
		const moved = git(project.path, ["branch", "-m", ws.branch, branch]);
		if (!moved.ok) throw new Error(`git branch -m failed: ${moved.err}`);
	}

	// Re-load after the git subprocess: another process can touch workspaces.json while the JS thread is
	// blocked in it (the e2e reset does exactly that). A record that vanished meanwhile was archived out
	// from under us — abort without saving rather than resurrect it (the moved branch ref is harmless).
	const all = loadWorkspaces();
	const target = all.find((w) => w.id === id);
	if (!target) throw new Error(`Unknown workspace: ${id}`);
	// Siblings this rename re-pointed. They are broadcast too: the *server* already has the right value (so
	// diffs are correct), but a sibling client would otherwise keep a stale `vs <old-name>` label and a stale
	// read key until the next `workspace.list`.
	const repointed: Workspace[] = [];
	for (const w of all) {
		if (w.projectId !== target.projectId || w.id === target.id) continue;
		// Both meanings follow the moved ref: creation provenance stays truthful, and a sibling that had this
		// branch as its *diff target* keeps measuring against it instead of silently emptying its diff.
		const changed = w.baseBranch === ws.branch || w.diffBase === ws.branch;
		if (w.baseBranch === ws.branch) w.baseBranch = branch;
		if (w.diffBase === ws.branch) w.diffBase = branch;
		if (changed) repointed.push(w);
	}
	if (target.baseBranch === ws.branch) target.baseBranch = branch;
	if (target.diffBase === ws.branch) target.diffBase = branch;
	target.name = displayName;
	target.branch = branch;
	if (lock) target.renamed = true;
	saveWorkspaces(all);
	// Persist-then-publish, one event per changed record (the target included).
	emit({ kind: "updated", workspace: target });
	for (const w of repointed) emit({ kind: "updated", workspace: w });
	return target;
}

/**
 * Set a per-workspace per-skill override (`on`/`off`) or clear it (`null`), and persist. Broadcasts the
 * updated workspace so every client's rail converges (like `renameWorkspace`). Throws for an unknown id.
 */
export function setWorkspaceSkillOverride(
	id: string,
	name: string,
	override: "on" | "off" | null,
): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const overrides = { ...(ws.skillOverrides ?? {}) };
	if (override === null) delete overrides[name];
	else overrides[name] = override;
	if (Object.keys(overrides).length > 0) ws.skillOverrides = overrides;
	else delete ws.skillOverrides;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

/**
 * Re-point the ref this workspace's diff is measured against (`Workspace.diffBase`), or clear it back to
 * the creation base with `null`. Persists + broadcasts the updated record, so every client converges on the
 * push rather than optimistically (modelled on `setWorkspaceSkillOverride`). A ref equal to `baseBranch`
 * clears the field instead of storing a redundant override. Throws for an unknown id / an empty ref / a ref
 * whose *shape* could be re-parsed by git as an option (`isSafeRef` — the branch list comes from the
 * repository, so an option-shaped name is reachable without a malicious client).
 */
export function setWorkspaceDiffBase(id: string, ref: string | null): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const wanted = ref?.trim();
	if (ref !== null && !wanted) throw new Error("A diff base must be a ref or null");
	if (wanted) assertSafeRef(wanted);
	if (!wanted || wanted === ws.baseBranch) delete ws.diffBase;
	else ws.diffBase = wanted;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function listWorkspaces(projectId: string): Workspace[] {
	// Lazily ensure the built-in Default workspace on every list: find-or-create is idempotent, backfills
	// projects opened before the feature existed, and self-heals out-of-band state churn (the e2e reset
	// rewrites workspaces.json mid-run). Unknown project → no ensure, the filter returns [] as before.
	const project = getProjects().find((p) => p.id === projectId);
	if (project) ensureDefaultWorkspace(project);
	const rows = loadWorkspaces().filter((w) => w.projectId === projectId);
	// Pin the Default workspace first (creation order would put a backfilled one last).
	rows.sort((a, b) => (a.kind === "default" ? -1 : 0) - (b.kind === "default" ? -1 : 0));
	return rows.map((w) => {
		const stats = diffStats(w);
		// Omitted, not zeroed, when git couldn't answer (`exactOptionalPropertyTypes`).
		return stats ? { ...w, diffStats: stats } : w;
	});
}

/**
 * Registry records without per-workspace git diffStats — for read paths (like history scope mapping)
 * that only need ids/paths and must not block the event loop on git spawns. Pure registry load.
 */
export function listWorkspaceRecords(projectId: string): Workspace[] {
	return loadWorkspaces().filter((w) => w.projectId === projectId);
}

/**
 * Drop a workspace's persistence record (fast) and return the removed record (or `null` if unknown). The
 * worktree/branch are reclaimed separately via `reclaimWorktree` — splitting the record-drop from the slow
 * git subprocess lets the host archive a workspace off the request's critical path (drop the record now so
 * it's gone from `listWorkspaces` immediately, reclaim the worktree in the background).
 */
export function forgetWorkspace(id: string): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) return null;
	// Loud, before any side-effect: the record's worktreePath is the project folder — forgetting it
	// would hand the archive teardown's `rm -rf` fallback the user's repo. The UI offers no Remove for
	// it; this guard is for buggy/rogue clients.
	if (ws.kind === "default") throw new Error("The Default workspace cannot be removed");
	saveWorkspaces(all.filter((w) => w.id !== id));
	emit({ kind: "removed", projectId: ws.projectId, id: ws.id });
	return ws;
}

/**
 * Reclaim a worktree from git + disk (the slow half of archiving — a `git worktree remove` subprocess).
 * Keeps the branch, so the work stays recoverable. Best-effort and hardened: on git failure, delete the
 * dir if it lingers then `prune` the stale registration so `git worktree list` never orphans it.
 */
export function reclaimWorktree(ws: Workspace): void {
	// Defense in depth: never reclaim the project folder itself (`git worktree remove` would refuse the
	// main working tree, but the hardened rm-fallback below would not).
	if (ws.kind === "default") return;
	const project = loadProjects().find((p) => p.id === ws.projectId);
	if (!project) return;
	// Defense in depth: never reclaim the repo's main working tree, however the record got here (a
	// corrupt or hand-edited registry) — git would refuse it, but the rm-fallback below would not.
	if (resolve(ws.worktreePath) === resolve(project.path)) return;
	const removed = git(project.path, ["worktree", "remove", "--force", ws.worktreePath]);
	if (!removed.ok) {
		rmSync(ws.worktreePath, { recursive: true, force: true });
		git(project.path, ["worktree", "prune"]);
	}
}

/** Archive a workspace synchronously: drop the record then reclaim the worktree (keeps the branch). */
export function removeWorkspace(id: string): void {
	const ws = forgetWorkspace(id);
	if (ws) reclaimWorktree(ws);
}

export function workspaceDiffStats(id: string): DiffStats {
	const ws = getWorkspace(id);
	const stats = diffStats(ws);
	// A failed read is an error response, never a fabricated `+0 −0`.
	if (!stats) throw new Error(`Could not read the diff stats of ${ws.name}`);
	return stats;
}

/** Look up a workspace by id (throws if unknown) — the worktree path anchors a chat session's cwd. */
export function getWorkspace(id: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	return ws;
}
