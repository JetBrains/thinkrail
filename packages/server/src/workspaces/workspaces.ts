import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiffStats, Project, Workspace } from "@thinkrail/contracts";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import { git, gitAsync } from "../git";
import { dataDir, loadProjects, loadWorkspaces, saveWorkspaces } from "../persistence";
import { getProjects } from "../projects";

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

/** Working-tree changes of a worktree vs its base branch. */
function diffStats(worktreePath: string, baseBranch: string): DiffStats {
	const result = git(worktreePath, ["diff", "--shortstat", baseBranch]);
	if (!result.ok || !result.out) return { added: 0, removed: 0 };
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
	const project = getProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);

	const all = loadWorkspaces();
	// A user-supplied name is the display name (casing/punctuation preserved); the branch is derived from
	// it. Omitted (or unusable) → the auto `workspace-N` placeholder, where name === branch.
	const displayName = name ? toDisplayName(name) : null;
	const branch = displayName
		? uniqueBranch(project, toBranch(displayName))
		: nextAutoBranch(project);
	const wsName = displayName ?? branch;

	const base = baseRef?.trim();
	let baseBranch: string;
	if (base) {
		// Fallback fetch only when the remote-tracking ref is missing locally, so `worktree add` can't fail on
		// an unknown ref (the freshness fetch already happened in the background via `prefetchBranch`). The
		// `rev-parse` guard is ~10ms; offline it degrades to whatever ref exists locally. Async (`gitAsync`) so
		// the network round-trip can't block the event loop; `--` guards against `-`-prefixed branch names.
		if (
			base.startsWith("origin/") &&
			!git(project.path, ["rev-parse", "--verify", "--quiet", base]).ok
		) {
			await gitAsync(project.path, ["fetch", "origin", "--", base.slice("origin/".length)]);
		}
		baseBranch = base;
	} else {
		const head = git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
		baseBranch = head.ok ? head.out : "HEAD";
	}

	const worktreePath = join(dataDir(), "worktrees", project.slug, branch);
	mkdirSync(dirname(worktreePath), { recursive: true });
	const added = git(project.path, ["worktree", "add", worktreePath, "-b", branch, baseBranch]);
	if (!added.ok) throw new Error(`git worktree add failed: ${added.err}`);

	// Ephemeral per-workspace scratch dir for temp docs (task-specs / working files). Its `.gitignore` is
	// a lone `*` — which matches the `.gitignore` itself — so the whole dir has zero git footprint yet
	// stays scannable by the spec tools (they ignore only node_modules/.git/dist/build, not .gitignore).
	const contextDir = join(worktreePath, WORKSPACE_CONTEXT_DIR);
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");

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
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

/**
 * Rename a workspace: its **display name** and its **git branch** (derived from the name), in place. The
 * name carries the human label (casing/punctuation preserved); the branch is `toBranch(name)`, made unique
 * (refs + worktree dirs) — so `name` and `branch` deliberately differ (e.g. `Fix Auth Redirect` /
 * `fix-auth-redirect`). The branch ref moves via `git branch -m` from the project repo (the worktree's
 * HEAD follows); the worktree directory never moves — pi keys sessions by exact cwd, and terminals/tabs are
 * rooted there, so the dir keeps its creation name. Re-points sibling records that based their diff on the
 * old branch. Sync on purpose: a caller's check-then-rename can't interleave on the event loop. Throws on
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
	for (const w of all) {
		if (w.projectId === target.projectId && w.baseBranch === ws.branch) w.baseBranch = branch;
	}
	target.name = displayName;
	target.branch = branch;
	if (lock) target.renamed = true;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: target });
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

export function listWorkspaces(projectId: string): Workspace[] {
	return loadWorkspaces()
		.filter((w) => w.projectId === projectId)
		.map((w) => ({ ...w, diffStats: diffStats(w.worktreePath, w.baseBranch) }));
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
	const project = loadProjects().find((p) => p.id === ws.projectId);
	if (!project) return;
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
	return diffStats(getWorkspace(id).worktreePath, getWorkspace(id).baseBranch);
}

/** Look up a workspace by id (throws if unknown) — the worktree path anchors a chat session's cwd. */
export function getWorkspace(id: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	return ws;
}
