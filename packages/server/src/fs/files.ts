import {
	closeSync,
	constants,
	type Dirent,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileNode, ResourceMeta } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
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

function resolveUnderRoot(root: string, path: string, followLeaf: boolean): string {
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(resolve(root), abs)) throw new Error("The .git directory is not readable");
	assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));
	return abs;
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	followLeaf: boolean,
): { root: string; abs: string; real: string } {
	const ws = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	const root = ws.worktreePath;
	const abs = resolveUnderRoot(root, path, followLeaf);
	if (!followLeaf) return { root, abs, real: abs };
	let realRoot: string;
	let real: string;
	try {
		realRoot = realpathSync(root);
		real = realpathSync(abs);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return { root, abs, real: abs };
		throw error;
	}
	if (!isContained(realRoot, real)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(realRoot, real)) throw new Error("The .git directory is not readable");
	return { root, abs, real };
}

const O_NOFOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

function openLeafNoFollow(abs: string): number {
	try {
		return openSync(abs, constants.O_RDONLY | O_NOFOLLOW);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ELOOP") throw new Error("Path escapes the worktree");
		throw error;
	}
}

export function readableFileSize(root: string, path: string): number | "missing" | null {
	try {
		const stats = statSync(resolveUnderRoot(root, path, true));
		return stats.isFile() ? stats.size : "missing";
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		return code === undefined || code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP"
			? "missing"
			: null;
	}
}

function entryKind(root: string, dir: string, entry: Dirent): FileNode["kind"] {
	if (entry.isDirectory()) return "dir";
	if (!entry.isSymbolicLink()) return "file";
	try {
		const target = join(dir, entry.name);
		if (!statSync(target).isDirectory()) return "file";
		return isContained(realpathSync(root), realpathSync(target)) ? "dir" : "file";
	} catch {
		return "file";
	}
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs, real } = resolveInWorktree(workspaceId, path, true);

	return readdirSync(real, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: posixRelative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entryKind(root, abs, entry),
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

const BOUNDED_READ_CHUNK = 64 * 1024;

function readBounded(fd: number, maxBytes: number): Uint8Array {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new Error("maxBytes must be a non-negative integer");
	}
	const chunks: Buffer[] = [];
	let total = 0;
	while (true) {
		const chunk = Buffer.allocUnsafe(Math.min(BOUNDED_READ_CHUNK, maxBytes + 1 - total));
		const read = readSync(fd, chunk, 0, chunk.length, total);
		if (read === 0) break;
		chunks.push(chunk.subarray(0, read));
		total += read;
		if (total > maxBytes) {
			throw new CodedError("FILE_TOO_LARGE", "The file is larger than the read allows");
		}
	}
	return Buffer.concat(chunks, total);
}

export function readFile(
	workspaceId: string,
	path: string,
	options: { readonly maxBytes?: number } = {},
): { content: string; meta: ResourceMeta } {
	const { real } = resolveInWorktree(workspaceId, path, true);
	const fd = openLeafNoFollow(real);
	try {
		const bytes =
			options.maxBytes === undefined ? readFileSync(fd) : readBounded(fd, options.maxBytes);
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
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).real;
}
