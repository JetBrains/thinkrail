import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { claimAndTrashFile } from "../trash";
import { posixRelative, resolveInWorktree } from "./files";

export const MAX_COPY_ENTRIES = 10_000;
const MAX_NAME_ATTEMPTS = 1_000;

type EntryKind = "file" | "dir" | "symlink";

interface EntryType {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

interface PlannedEntry {
	path: string;
	kind: EntryKind;
}

interface CopyWorktreeEntryParams {
	sourceWorkspaceId: string;
	sourcePath: string;
	destinationWorkspaceId: string;
	destinationDirectory: string;
}

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function entryKind(entry: EntryType): EntryKind | null {
	if (entry.isSymbolicLink()) return "symlink";
	if (entry.isDirectory()) return "dir";
	return entry.isFile() ? "file" : null;
}

function nativePath(base: string, posixPath: string): string {
	return join(base, ...posixPath.split("/"));
}

export function copyName(name: string, kind: EntryKind, attempt: number): string {
	if (attempt === 0) return name;
	const extension = kind === "dir" ? "" : extname(name);
	const stem = name.slice(0, name.length - extension.length);
	return `${stem} copy${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
}

async function planFolder(source: string): Promise<PlannedEntry[]> {
	const planned: PlannedEntry[] = [];
	const pending = [""];
	for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
		for (const entry of await readdir(nativePath(source, folder), { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const path = folder ? `${folder}/${entry.name}` : entry.name;
			const kind = entryKind(entry);
			if (kind === null) throw new Error(`${path} is not a file, folder, or link`);
			if (planned.length === MAX_COPY_ENTRIES) {
				throw new CodedError(
					"COPY_TOO_LARGE",
					`The folder has more than ${MAX_COPY_ENTRIES} entries to copy`,
				);
			}
			planned.push({ path, kind });
			if (kind === "dir") pending.push(path);
		}
	}
	return planned;
}

async function copyEntry(from: string, to: string, kind: EntryKind): Promise<void> {
	if (kind === "dir") await mkdir(to);
	else if (kind === "symlink") await symlink(await readlink(from), to);
	else await copyFile(from, to, constants.COPYFILE_EXCL);
}

async function claimFreeName(source: string, directory: string, kind: EntryKind): Promise<string> {
	const name = basename(source);
	for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
		const target = join(directory, copyName(name, kind, attempt));
		try {
			await copyEntry(source, target, kind);
			return target;
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	}
	throw new Error(`No free name for a copy of ${name}`);
}

export async function copyWorktreeEntry(
	params: CopyWorktreeEntryParams,
): Promise<{ path: string; written: string[] }> {
	const source = resolveInWorktree(params.sourceWorkspaceId, params.sourcePath, false);
	const destination = resolveInWorktree(
		params.destinationWorkspaceId,
		params.destinationDirectory,
		true,
	);
	if (!(await stat(destination.abs)).isDirectory()) {
		throw new Error("The paste destination is not a folder");
	}
	const kind = entryKind(await lstat(source.abs));
	if (kind === null) throw new Error("Only files, folders, and links can be copied");
	const planned = kind === "dir" ? await planFolder(source.abs) : [];

	const target = await claimFreeName(source.abs, destination.abs, kind);
	const path = posixRelative(destination.root, target);
	for (const entry of planned) {
		await copyEntry(nativePath(source.abs, entry.path), nativePath(target, entry.path), entry.kind);
	}
	return { path, written: [path, ...planned.map((entry) => `${path}/${entry.path}`)] };
}

export async function deleteWorktreeEntry(
	workspaceId: string,
	path: string,
): Promise<{ path: string; directory: boolean }> {
	const { root, abs } = resolveInWorktree(workspaceId, path, false);
	const directory = (await lstat(abs)).isDirectory();
	const token = randomUUID();
	await claimAndTrashFile(
		abs,
		join(dirname(abs), `.thinkrail-delete-${token}`),
		join(dirname(abs), `.thinkrail-recovery-${token}`),
	);
	return { path: posixRelative(root, abs), directory };
}
