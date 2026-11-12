import { randomUUID } from "node:crypto";
import {
	type BigIntStats,
	closeSync,
	constants,
	createReadStream,
	createWriteStream,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readlinkSync,
	realpathSync,
	symlinkSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setImmediate as nextTurn } from "node:timers/promises";
import { CodedError } from "@thinkrail/shared/codedError";
import { claimAndTrashFile } from "../trash";
import { isWorktreeContent, posixRelative, resolveInWorktree } from "./files";

export const MAX_COPY_ENTRIES = 10_000;
const MAX_NAME_ATTEMPTS = 1_000;
const READ_NO_FOLLOW = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE_EXCLUSIVE =
	constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const VANISHED = new Set<unknown>(["ENOENT", "ENOTDIR", "ELOOP", "EMLINK"]);
const TAKEN_OR_VANISHED = new Set<unknown>([...VANISHED, "EEXIST"]);

type EntryKind = "file" | "dir" | "symlink";
type Identity = Pick<BigIntStats, "dev" | "ino">;

interface TrackedDirectory {
	root: string;
	path: string;
	identity: Identity;
}

interface SourceEntry {
	parent: TrackedDirectory;
	name: string;
	kind: EntryKind;
	identity: Identity;
}

interface PlannedEntry extends SourceEntry {
	path: string;
}

type Place = <T>(make: (path: string) => T) => { path: string; made: T };

interface CopyWorktreeEntryParams {
	sourceWorkspaceId: string;
	sourcePath: string;
	destinationWorkspaceId: string;
	destinationDirectory: string;
}

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function entryKind(entry: BigIntStats): EntryKind | null {
	if (entry.isSymbolicLink()) return "symlink";
	if (entry.isDirectory()) return "dir";
	return entry.isFile() ? "file" : null;
}

function sameEntry(stats: Identity, identity: Identity): boolean {
	return stats.dev === identity.dev && stats.ino === identity.ino;
}

function changed(label: string): CodedError {
	return new CodedError(
		"ENTRY_CHANGED",
		`${label} changed during the copy, so the copy stopped and kept what it had written`,
	);
}

function asChanged(label: string, codes = VANISHED): (error: unknown) => never {
	return (error) => {
		throw codes.has(errorCode(error)) ? changed(label) : error;
	};
}

function guarded<T>(label: string, step: () => T, codes = VANISHED): T {
	try {
		return step();
	} catch (error) {
		return asChanged(label, codes)(error);
	}
}

export function copyName(name: string, kind: EntryKind, attempt: number): string {
	if (attempt === 0) return name;
	const extension = kind === "dir" ? "" : extname(name);
	const stem = name.slice(0, name.length - extension.length);
	return `${stem} copy${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
}

function verifiedDirectory(directory: TrackedDirectory, label: string): string {
	const real = guarded(label, () => realpathSync(directory.path));
	const stats = guarded(label, () => lstatSync(real, { bigint: true }));
	if (!isWorktreeContent(directory.root, real) || !sameEntry(stats, directory.identity)) {
		throw changed(label);
	}
	return real;
}

function trackDirectory(root: string, path: string, label: string): TrackedDirectory {
	const stats = guarded(label, () => lstatSync(path, { bigint: true }));
	if (!stats.isDirectory()) throw changed(label);
	return { root, path, identity: stats };
}

function inside(parent: TrackedDirectory, name: string, label: string): Place {
	return (make) => {
		const path = join(verifiedDirectory(parent, label), name);
		return { path, made: guarded(label, () => make(path), TAKEN_OR_VANISHED) };
	};
}

function firstFree(parent: TrackedDirectory, name: string, kind: EntryKind): Place {
	return (make) => {
		for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
			const path = join(verifiedDirectory(parent, name), copyName(name, kind, attempt));
			try {
				return { path, made: guarded(name, () => make(path)) };
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
			}
		}
		throw new Error(`No free name for a copy of ${name}`);
	};
}

async function planFolder(folder: TrackedDirectory, label: string): Promise<PlannedEntry[]> {
	const planned: PlannedEntry[] = [];
	const pending: { path: string; directory: TrackedDirectory }[] = [
		{ path: "", directory: folder },
	];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const { path: folderPath, directory } = next;
		const folderLabel = folderPath ? `${label}/${folderPath}` : label;
		const names = await readdir(directory.path).catch(asChanged(folderLabel));
		const real = verifiedDirectory(directory, folderLabel);
		for (const name of names) {
			if (name === ".git") continue;
			const path = folderPath ? `${folderPath}/${name}` : name;
			const stats = guarded(`${label}/${path}`, () =>
				lstatSync(join(real, name), { bigint: true }),
			);
			const kind = entryKind(stats);
			if (kind === null) throw new Error(`${path} is not a file, folder, or link`);
			if (planned.length === MAX_COPY_ENTRIES) {
				throw new CodedError(
					"COPY_TOO_LARGE",
					`The folder has more than ${MAX_COPY_ENTRIES} entries to copy`,
				);
			}
			planned.push({ path, parent: directory, name, kind, identity: stats });
			if (kind === "dir") {
				pending.push({
					path,
					directory: { root: folder.root, path: join(real, name), identity: stats },
				});
			}
		}
	}
	return planned;
}

function openSource(entry: SourceEntry, label: string): { path: string; fd: number; mode: number } {
	const from = join(verifiedDirectory(entry.parent, label), entry.name);
	const fd = guarded(label, () => openSync(from, READ_NO_FOLLOW));
	try {
		const stats = fstatSync(fd, { bigint: true });
		if (!stats.isFile() || !sameEntry(stats, entry.identity)) throw changed(label);
		return { path: from, fd, mode: Number(stats.mode & 0o777n) };
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

function linkTarget(entry: SourceEntry, label: string): string {
	const from = join(verifiedDirectory(entry.parent, label), entry.name);
	const stats = guarded(label, () => lstatSync(from, { bigint: true }));
	if (!stats.isSymbolicLink() || !sameEntry(stats, entry.identity)) throw changed(label);
	return guarded(label, () => readlinkSync(from));
}

function assertPlaced(parent: TrackedDirectory, path: string, label: string): void {
	if (verifiedDirectory(parent, label) !== dirname(path)) throw changed(label);
}

async function copyEntry(
	entry: SourceEntry,
	label: string,
	destination: { parent: TrackedDirectory; place: Place },
): Promise<{ path: string; directory: TrackedDirectory | null }> {
	const { parent, place } = destination;
	if (entry.kind === "dir") {
		const { path } = place((target) => mkdirSync(target));
		assertPlaced(parent, path, label);
		return { path, directory: trackDirectory(parent.root, path, label) };
	}
	if (entry.kind === "symlink") {
		const link = linkTarget(entry, label);
		const { path } = place((target) => symlinkSync(link, target));
		assertPlaced(parent, path, label);
		return { path, directory: null };
	}
	const source = openSource(entry, label);
	try {
		const { path, made: target } = place((candidate) =>
			openSync(candidate, CREATE_EXCLUSIVE, 0o600),
		);
		try {
			assertPlaced(parent, path, label);
			const created = guarded(label, () => lstatSync(path, { bigint: true }));
			if (!sameEntry(created, fstatSync(target, { bigint: true }))) throw changed(label);
			fchmodSync(target, source.mode);
			await pipeline(
				createReadStream(source.path, { fd: source.fd, autoClose: false }),
				createWriteStream(path, { fd: target, autoClose: false }),
			);
		} finally {
			closeSync(target);
		}
		return { path, directory: null };
	} finally {
		closeSync(source.fd);
	}
}

function parentPath(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
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
	const destinationRoot = realpathSync(destination.root);
	const folder = lstatSync(destination.real, { bigint: true });
	if (folder.isSymbolicLink()) throw changed(params.destinationDirectory);
	if (!folder.isDirectory()) throw new Error("The paste destination is not a folder");
	const sourceRoot = realpathSync(source.root);
	const name = basename(source.abs);
	const stats = lstatSync(join(source.real, name), { bigint: true });
	const kind = entryKind(stats);
	if (kind === null) throw new Error("Only files, folders, and links can be copied");
	const top: SourceEntry = {
		parent: trackDirectory(sourceRoot, source.real, name),
		name,
		kind,
		identity: stats,
	};
	const planned =
		kind === "dir"
			? await planFolder({ root: sourceRoot, path: join(source.real, name), identity: stats }, name)
			: [];

	const into: TrackedDirectory = {
		root: destinationRoot,
		path: destination.real,
		identity: folder,
	};
	const copied = await copyEntry(top, name, { parent: into, place: firstFree(into, name, kind) });
	const path = posixRelative(destinationRoot, copied.path);
	const created = new Map<string, TrackedDirectory | null>([["", copied.directory]]);
	for (const entry of planned) {
		await nextTurn();
		const parent = created.get(parentPath(entry.path));
		if (!parent) throw new Error(`${entry.path} has no copied parent folder`);
		const label = `${name}/${entry.path}`;
		const result = await copyEntry(entry, label, {
			parent,
			place: inside(parent, entry.name, label),
		});
		created.set(entry.path, result.directory);
	}
	return { path, written: [path, ...planned.map((entry) => `${path}/${entry.path}`)] };
}

export async function deleteWorktreeEntry(
	workspaceId: string,
	path: string,
): Promise<{ path: string; directory: boolean }> {
	const { root, abs, real } = resolveInWorktree(workspaceId, path, false);
	const stats = lstatSync(abs, { bigint: true });
	const token = randomUUID();
	await claimAndTrashFile(
		abs,
		join(dirname(abs), `.thinkrail-delete-${token}`),
		join(dirname(abs), `.thinkrail-recovery-${token}`),
		{ parent: real, dev: stats.dev, ino: stats.ino },
	);
	return { path: posixRelative(root, abs), directory: stats.isDirectory() };
}
