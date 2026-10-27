import { readdirSync, readFileSync, realpathSync } from "node:fs";
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

function trimWin32TrailingDotsAndSpaces(segment: string): string {
	let end = segment.length;
	while (end > 0) {
		const code = segment.charCodeAt(end - 1);
		if (code === 46 /* '.' */ || code === 32 /* ' ' */) {
			end--;
		} else {
			break;
		}
	}
	return end === segment.length ? segment : segment.slice(0, end);
}

function isSameFileOrDir(pathA: string, pathB: string): boolean {
	const realpath = typeof realpathSync.native === "function" ? realpathSync.native : realpathSync;
	try {
		return realpath(pathA).toLowerCase() === realpath(pathB).toLowerCase();
	} catch {
		return false;
	}
}

function isGitSegmentInDir(parentDir: string, segment: string): boolean {
	if (process.platform === "win32") {
		const streamStripped = segment.split(":")[0] ?? "";
		const entryName = trimWin32TrailingDotsAndSpaces(streamStripped);
		const base = entryName.toLowerCase();
		if (base === ".git") return true;
		if (/^git~\d+$/i.test(base)) {
			return isSameFileOrDir(join(parentDir, entryName), join(parentDir, ".git"));
		}
		return false;
	}
	return segment === ".git";
}

function isGitMetadataPath(root: string, candidate: string): boolean {
	if (process.platform !== "win32") {
		return relative(root, candidate).split(sep).includes(".git");
	}

	const rel = relative(root, candidate);
	if (rel === "" || rel === ".") return false;

	const n = rel.length;
	let start = 0;
	let prevEnd = 0;

	for (let i = 0; i <= n; i++) {
		const isSep =
			i === n || rel.charCodeAt(i) === 47 /* '/' */ || rel.charCodeAt(i) === 92 /* '\\' */;
		if (isSep) {
			if (i > start) {
				const segment = rel.slice(start, i);
				if (segment !== ".") {
					const streamStripped = segment.split(":")[0] ?? "";
					const entryName = trimWin32TrailingDotsAndSpaces(streamStripped);
					const base = entryName.toLowerCase();
					if (base === ".git") return true;
					if (/^git~\d+$/i.test(base)) {
						const parentRel = prevEnd > 0 ? rel.slice(0, prevEnd) : "";
						const parentDir = parentRel.length > 0 ? join(root, parentRel) : root;
						if (isSameFileOrDir(join(parentDir, entryName), join(parentDir, ".git"))) {
							return true;
						}
					}
				}
				prevEnd = i;
			}
			start = i + 1;
		}
	}

	return false;
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
	return { root, abs };
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path, true);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => !isGitSegmentInDir(abs, entry.name))
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
	const bytes = readFileSync(abs);
	const meta = resourceMeta(bytes, path);
	return { content: meta.text ? decodeText(bytes) : "", meta };
}

export function resolveWorktreeFile(
	workspaceId: string,
	path: string,
	options: { followLeaf?: boolean } = {},
): string {
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).abs;
}
