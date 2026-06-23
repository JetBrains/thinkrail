import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiffStats, Workspace } from "@thinkrail-pi/contracts";
import { git } from "./gitExec";
import { dataDir, loadProjects, loadWorkspaces, saveWorkspaces } from "./persistence";
import { getProjects } from "./projects";

function toBranch(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "workspace"
	);
}

function branchExists(repoPath: string, branch: string): boolean {
	return git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

/** A branch name not yet in the repo — `base`, else `base-2`, `base-3`, … (archiving leaves branches). */
function uniqueBranch(repoPath: string, base: string): string {
	if (!branchExists(repoPath, base)) return base;
	let n = 2;
	while (branchExists(repoPath, `${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

/** First free `workspace-N` — skips branches left behind by archived workspaces. */
function nextAutoBranch(repoPath: string): string {
	let n = 1;
	while (branchExists(repoPath, `workspace-${n}`)) n += 1;
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

/** Create a workspace = a `git worktree` on its own branch, under the data dir. */
export function createWorkspace(projectId: string, name?: string): Workspace {
	const project = getProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);

	const all = loadWorkspaces();
	const branch = name?.trim()
		? uniqueBranch(project.path, toBranch(name))
		: nextAutoBranch(project.path);
	const wsName = branch;

	const head = git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const baseBranch = head.ok ? head.out : "HEAD";

	const worktreePath = join(dataDir(), "worktrees", project.slug, branch);
	mkdirSync(dirname(worktreePath), { recursive: true });
	const added = git(project.path, ["worktree", "add", worktreePath, "-b", branch]);
	if (!added.ok) throw new Error(`git worktree add failed: ${added.err}`);

	const workspace: Workspace = {
		id: randomUUID(),
		projectId,
		name: wsName,
		branch,
		worktreePath,
		baseBranch,
	};
	all.push(workspace);
	saveWorkspaces(all);
	return workspace;
}

export function listWorkspaces(projectId: string): Workspace[] {
	return loadWorkspaces()
		.filter((w) => w.projectId === projectId)
		.map((w) => ({ ...w, diffStats: diffStats(w.worktreePath, w.baseBranch) }));
}

/** Archive a workspace: drop its worktree (keep the branch — the work stays recoverable). */
export function removeWorkspace(id: string): void {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (ws) {
		const project = loadProjects().find((p) => p.id === ws.projectId);
		if (project) {
			const removed = git(project.path, ["worktree", "remove", "--force", ws.worktreePath]);
			if (!removed.ok) {
				// Fallback (path drift, dir gone, etc.): delete the dir if it lingers, then prune the
				// stale registration so `git worktree list` stays clean and the worktree never orphans.
				rmSync(ws.worktreePath, { recursive: true, force: true });
				git(project.path, ["worktree", "prune"]);
			}
		}
	}
	saveWorkspaces(all.filter((w) => w.id !== id));
}

export function workspaceDiffStats(id: string): DiffStats {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	return diffStats(ws.worktreePath, ws.baseBranch);
}
