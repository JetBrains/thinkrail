import type {
	BranchList,
	GitFileChange,
	GitFileStatus,
	GitStatus,
	Workspace,
} from "@thinkrail-pi/contracts";
import { loadProjects, loadWorkspaces } from "../persistence";
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

	let defaultBranch: string;
	const head = git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
	if (head.ok && head.out) defaultBranch = head.out;
	else if (remote.includes("origin/main")) defaultBranch = "origin/main";
	else {
		const repoHead = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		defaultBranch = repoHead.ok && repoHead.out ? repoHead.out : "HEAD";
	}

	return { local, remote, defaultBranch };
}

/**
 * Best-effort **background** fetch of a remote branch, so a *subsequent* `createWorkspace` branches off a
 * fresh tip without paying the ~2s network round-trip on the create critical path. The New-Workspace dialog
 * fires this when it opens (for the default base) and when a different remote base is picked — the fetch
 * overlaps the time the user spends choosing a branch / typing the prompt, so the create itself stays local
 * and instant. Async (`gitAsync`, never `spawnSync`) so the network fetch can't block the host's event
 * loop; a local (non-`origin/`) ref or an offline/failed fetch is a harmless no-op ack.
 */
export async function prefetchBranch(projectId: string, ref: string): Promise<{ ok: boolean }> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project || !ref.startsWith("origin/")) return { ok: false };
	// `--` so a `-`-prefixed branch name can't be parsed by git as an option.
	const result = await gitAsync(project.path, [
		"fetch",
		"origin",
		"--",
		ref.slice("origin/".length),
	]);
	return { ok: result.ok };
}

/** Map a `git diff --name-status` code (`M`, `A`, `D`, `R100`, …) to our status enum. */
function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

/** A worktree's changed files vs its base branch, plus any untracked files. */
export function gitStatus(workspaceId: string): GitStatus {
	const ws = workspace(workspaceId);
	const changes: GitFileChange[] = [];

	const tracked = git(ws.worktreePath, ["diff", "--name-status", ws.baseBranch]);
	if (tracked.ok && tracked.out) {
		for (const line of tracked.out.split("\n")) {
			const parts = line.split("\t");
			const code = parts[0] ?? "";
			// Renames/copies have a third field (old → new); take the destination path.
			const path = parts.length > 2 ? parts[parts.length - 1] : parts[1];
			if (path) changes.push({ path, status: mapStatus(code) });
		}
	}

	const untracked = git(ws.worktreePath, ["ls-files", "--others", "--exclude-standard"]);
	if (untracked.ok && untracked.out) {
		for (const path of untracked.out.split("\n")) {
			if (path) changes.push({ path, status: "untracked" });
		}
	}

	changes.sort((a, b) => a.path.localeCompare(b.path));
	return { branch: ws.branch, changes };
}

/** A unified diff for the whole worktree (vs base) or one file. Untracked files are shown in full. */
export function gitDiff(workspaceId: string, path?: string): { diff: string } {
	const ws = workspace(workspaceId);
	if (!path) return { diff: git(ws.worktreePath, ["diff", "--no-color", ws.baseBranch]).out };

	const untracked = git(ws.worktreePath, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"--",
		path,
	]);
	if (untracked.ok && untracked.out) {
		// `git diff --no-index` exits non-zero when files differ; the patch is still on stdout.
		return {
			diff: git(ws.worktreePath, ["diff", "--no-color", "--no-index", "/dev/null", path]).out,
		};
	}
	return { diff: git(ws.worktreePath, ["diff", "--no-color", ws.baseBranch, "--", path]).out };
}
