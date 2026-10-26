import { closeSync, constants, openSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileNode, ResourceMeta } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";
import { decodeText, resourceMeta } from "./content";

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function posixRelative(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

export function workspaceRelativePath(root: string, path: string): string | null {
	const base = resolve(root);
	const abs = resolve(base, path);
	return isContained(base, abs) ? posixRelative(base, abs) : null;
}

function isGitMetadataPath(root: string, candidate: string): boolean {
	return relative(root, candidate).split(sep).includes(".git");
}

function assertExistingAncestorContained(root: string, abs: string): void {
	const realRoot = realpathSync(root);
	let cursor = abs;
	while (true) {
		let real: string;
		try {
			real = realpathSync(cursor);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			cursor = parent;
			continue;
		}
		if (!isContained(realRoot, real)) throw new Error("Path escapes the worktree");
		if (isGitMetadataPath(realRoot, real)) throw new Error("The .git directory is not readable");
		return;
	}
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	followLeaf: boolean,
): { root: string; abs: string } {
	const ws = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(resolve(root), abs)) throw new Error("The .git directory is not readable");
	assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));

	// Security: Re-resolve via realpathSync and re-check containment. This alone
	// does NOT fully close the TOCTOU window (a race remains between realpathSync
	// and the subsequent file read). The full fix pairs this with O_NOFOLLOW in
	// readFile() so the kernel refuses symlink indirection at open time.
	// See security/SECURITY_REPORT.md (Finding-3) for details.
	if (followLeaf) {
		try {
			const resolvedAbs = realpathSync(abs);
			const resolvedRoot = realpathSync(root);
			if (!isContained(resolvedRoot, resolvedAbs))
				throw new Error("Path escapes the worktree");
			if (isGitMetadataPath(resolvedRoot, resolvedAbs))
				throw new Error("The .git directory is not readable");
			return { root: resolvedRoot, abs: resolvedAbs };
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? (error as { code: string }).code
					: undefined;
			if (code === "ENOENT" || code === "ENOTDIR") return { root, abs };
			throw error;
		}
	}
	return { root, abs };
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path, true);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: posixRelative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readFile(
	workspaceId: string,
	path: string,
): { content: string; meta: ResourceMeta } {
	const { abs } = resolveInWorktree(workspaceId, path, true);

	// Security: Open with O_NOFOLLOW so the kernel refuses to follow symlinks
	// at the leaf. Combined with the realpathSync re-check in resolveInWorktree,
	// this eliminates the TOCTOU race: if an attacker swaps the resolved path to
	// a symlink between realpathSync and open, O_NOFOLLOW causes ELOOP and the
	// read is aborted. Reading via fd ensures we read the same inode we opened.
	const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	let fd: number;
	try {
		fd = openSync(abs, constants.O_RDONLY | noFollow);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? (error as { code: string }).code
				: undefined;
		// ELOOP means O_NOFOLLOW caught a symlink — treat as path escape
		if (code === "ELOOP") throw new Error("Path escapes the worktree");
		throw error;
	}
	try {
		const bytes = new Uint8Array(readFileSync(fd));
		const meta = resourceMeta(bytes, path);
		return { content: meta.text ? decodeText(bytes) : "", meta };
	} finally {
		closeSync(fd);
	}
}

export function resolveWorktreeFile(
	workspaceId: string,
	path: string,
	options: { followLeaf?: boolean } = {},
): string {
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).abs;
}
