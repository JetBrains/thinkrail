import { resolve } from "node:path";
import { canonicalPath, gitAsync } from "../git";

export interface GitWorktreeEntry {
	path: string;
	branch?: string;
	prunable: boolean;
}

export async function gitWorktreeEntries(repoPath: string): Promise<GitWorktreeEntry[]> {
	const listed = await gitAsync(repoPath, ["worktree", "list", "--porcelain", "-z"], { raw: true });
	if (!listed.ok) throw new Error(`git worktree list failed: ${listed.err}`);
	const entries: GitWorktreeEntry[] = [];
	for (const record of listed.out.split("\0\0")) {
		if (!record) continue;
		let path: string | undefined;
		let branch: string | undefined;
		let prunable = false;
		for (const field of record.split("\0")) {
			if (field.startsWith("worktree ")) path = field.slice("worktree ".length);
			else if (field.startsWith("branch refs/heads/")) {
				branch = field.slice("branch refs/heads/".length);
			} else if (field === "prunable" || field.startsWith("prunable ")) prunable = true;
		}
		if (path) entries.push({ path: resolve(path), prunable, ...(branch ? { branch } : {}) });
	}
	return entries;
}

export function samePath(a: string, b: string): boolean {
	return canonicalPath(a) === canonicalPath(b);
}
