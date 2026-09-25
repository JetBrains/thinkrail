import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { type FileHandle, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { DagError, fail } from "../domain/index.ts";

export function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

export function storageError(error: unknown): DagError {
	return error instanceof DagError
		? error
		: new DagError({
				code: "storage-error",
				message: error instanceof Error ? error.message : "DAG storage operation failed",
			});
}

export async function guarded<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw storageError(error);
	}
}

export function digest(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalRoot(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw storageError(error);
		return join(canonicalRoot(dirname(absolute)), basename(absolute));
	}
}

export function safeId(
	id: string,
	code: "invalid-command" | "corrupt-state" = "invalid-command",
): void {
	if (id.length > 128 || !/^[a-zA-Z0-9]/.test(id) || /[^a-zA-Z0-9._-]/.test(id))
		fail(code, "Unsafe DAG id");
}

export async function directory(path: string, create = false): Promise<boolean> {
	if (path !== parse(path).root && !(await directory(dirname(path), create))) return false;
	try {
		if (create) {
			try {
				await mkdir(path, { mode: 0o700 });
				await syncDirectory(dirname(path));
			} catch (error) {
				if (!hasCode(error, "EEXIST")) throw error;
			}
		}
		if (!(await lstat(path)).isDirectory()) fail("corrupt-state", "Unsafe storage directory");
		return true;
	} catch (error) {
		if (!create && hasCode(error, "ENOENT")) return false;
		throw error;
	}
}

export function regularHint(path: string, size: number): void {
	if (realpathSync(path) !== path) fail("corrupt-state", "Symlinked payload path");
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.size !== size) fail("corrupt-state", "Invalid payload file or size");
}

export async function readRegular(
	path: string,
	maxBytes?: number,
): Promise<Uint8Array | undefined> {
	let file: FileHandle;
	try {
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		if (hasCode(error, "ELOOP")) fail("corrupt-state", "Symlinked storage file");
		throw error;
	}
	try {
		const stat = await file.stat();
		if (!stat.isFile()) fail("corrupt-state", "Storage content is not a regular file");
		if (maxBytes !== undefined && stat.size > maxBytes)
			fail("corrupt-state", "Storage content exceeds its declared bound");
		return await file.readFile();
	} finally {
		await file.close();
	}
}

export function json(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return fail("corrupt-state", "Invalid stored JSON");
	}
}

export async function removeTemp(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
}

export async function writeTemp(dir: string, bytes: string | Uint8Array): Promise<string> {
	const path = join(dir, `.tmp-${randomUUID()}`);
	const file = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		try {
			await file.writeFile(bytes);
			await file.sync();
		} finally {
			await file.close();
		}
		return path;
	} catch (error) {
		await removeTemp(path);
		throw error;
	}
}

export async function syncDirectory(path: string): Promise<void> {
	if ((await realpath(path)) !== path) fail("corrupt-state", "Symlinked storage directory");
	const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		await file.sync();
	} finally {
		await file.close();
	}
}

export async function publishExclusive(path: string, bytes: string | Uint8Array): Promise<boolean> {
	const dir = dirname(path);
	const temporary = await writeTemp(dir, bytes);
	let published = false;
	let failure: DagError | undefined;
	try {
		try {
			await link(temporary, path);
			published = true;
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
		}
		if (published) await syncDirectory(dir);
	} catch (error) {
		failure = published
			? new DagError({ code: "commit-unknown", message: "File publication durability is unknown" })
			: storageError(error);
	}
	try {
		await removeTemp(temporary);
	} catch (error) {
		failure ??= published
			? new DagError({ code: "commit-unknown", message: "Published file cleanup failed" })
			: storageError(error);
	}
	if (failure) throw failure;
	return published;
}
