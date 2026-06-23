import type { GitFileChange, GitFileStatus, GitStatus, Workspace } from "@thinkrail-pi/contracts";
import { git } from "./gitExec";
import { loadWorkspaces } from "./persistence";

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
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
