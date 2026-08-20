import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";

function resolveInWorktree(workspaceId: string, path: string): { root: string; abs: string } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");
	return { root, abs };
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: relative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readFile(workspaceId: string, path: string): { content: string } {
	const { abs } = resolveInWorktree(workspaceId, path);
	return { content: readFileSync(abs, "utf8") };
}

export function resolveWorktreeFile(workspaceId: string, path: string): string {
	return resolveInWorktree(workspaceId, path).abs;
}
