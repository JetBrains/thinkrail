import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";

/** Resolve `path` (relative to the worktree root) to an absolute path, refusing anything that escapes it. */
function resolveInWorktree(workspaceId: string, path: string): { root: string; abs: string } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");
	return { root, abs };
}

/** List a directory inside a workspace's worktree. `path` is relative to the worktree root. */
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

/** Read a UTF-8 text file inside a workspace's worktree. `path` is relative to the worktree root. */
export function readFile(workspaceId: string, path: string): { content: string } {
	const { abs } = resolveInWorktree(workspaceId, path);
	return { content: readFileSync(abs, "utf8") };
}

/**
 * Write a UTF-8 text file inside a workspace's worktree (`path` worktree-relative, contained). This is the
 * ONE host-side write path — a **user-initiated** action (Revert in inline-editing), never an agent edit
 * (those go through pi). `ifMatchContent`, when given, is optimistic-concurrency: refuse if the file no
 * longer matches, so a Revert can't clobber a change that landed since the user last saw the file.
 */
export function writeFile(
	workspaceId: string,
	path: string,
	content: string,
	ifMatchContent?: string,
): { ok: true } {
	const { abs } = resolveInWorktree(workspaceId, path);
	if (ifMatchContent !== undefined) {
		const current = readFileSync(abs, "utf8");
		if (current !== ifMatchContent) throw new Error("File changed on disk");
	}
	writeFileSync(abs, content, "utf8");
	return { ok: true };
}

/**
 * Resolve `path` (relative to the worktree root) to an absolute path for serving the file's raw bytes
 * over HTTP (e.g. a relative image in the markdown viewer). Refuses anything escaping the worktree — the
 * same guard as the read RPCs. The caller streams the bytes (`Bun.file(abs)`); this owns path safety.
 */
export function resolveWorktreeFile(workspaceId: string, path: string): string {
	return resolveInWorktree(workspaceId, path).abs;
}
