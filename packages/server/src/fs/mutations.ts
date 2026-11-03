import { randomUUID } from "node:crypto";
import { constants, copyFile, lstatSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { extname, join as joinWirePath } from "node:path/posix";
import { promisify } from "node:util";
import { claimAndTrashFile } from "../trash";
import { resolveWorktreeFile } from "./files";

const copyFileAsync = promisify(copyFile);

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function copiedName(name: string, attempt: number): string {
	if (attempt === 0) return name;
	const extension = extname(name);
	const stem = extension ? name.slice(0, -extension.length) : name;
	return `${stem} copy${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
}

export async function copyWorkspaceFile(params: {
	sourceWorkspaceId: string;
	sourcePath: string;
	destinationWorkspaceId: string;
	destinationDirectory: string;
}): Promise<{ path: string }> {
	const source = resolveWorktreeFile(params.sourceWorkspaceId, params.sourcePath);
	if (!lstatSync(source).isFile()) throw new Error("Only regular files can be copied");
	const destinationDirectory = resolveWorktreeFile(
		params.destinationWorkspaceId,
		params.destinationDirectory,
	);
	if (!statSync(destinationDirectory).isDirectory())
		throw new Error("Paste destination is not a folder");

	const sourceName = params.sourcePath.split("/").at(-1);
	if (!sourceName) throw new Error("Copy source must name a file");
	for (let attempt = 0; ; attempt += 1) {
		const path = joinWirePath(params.destinationDirectory, copiedName(sourceName, attempt));
		const destination = resolveWorktreeFile(params.destinationWorkspaceId, path, {
			followLeaf: false,
		});
		try {
			await copyFileAsync(source, destination, constants.COPYFILE_EXCL);
			return { path };
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	}
}

export async function deleteWorkspaceFile(workspaceId: string, path: string): Promise<void> {
	const absolute = resolveWorktreeFile(workspaceId, path, { followLeaf: false });
	if (!lstatSync(absolute).isFile()) throw new Error("Only regular files can be deleted");
	const token = randomUUID();
	const directory = dirname(absolute);
	await claimAndTrashFile(
		absolute,
		join(directory, `.thinkrail-delete-${token}`),
		join(directory, `.thinkrail-recovery-${token}`),
	);
}
