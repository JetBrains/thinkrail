/// <reference path="./procfs.d.ts" />

import { execFile } from "node:child_process";
import { linkSync, lstatSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { promisify } from "node:util";
import processMountinfo from "@stroncium/procfs/lib/parsers/processMountinfo.js";
import procfsParsers from "@stroncium/procfs/lib/parsers.js";
import trash from "trash";

if (!Object.hasOwn(procfsParsers, "processMountinfo")) {
	Object.defineProperty(procfsParsers, "processMountinfo", { value: processMountinfo });
}

export type TrashImplementation = (
	input: string | readonly string[],
	options?: { readonly glob?: boolean },
) => Promise<void>;

export interface BundledTrashHelpers {
	readonly macos: string;
	readonly windows: string;
}

let bundledHelpers: BundledTrashHelpers | undefined;
let testImplementation: TrashImplementation | undefined;

export function setTrashImplementationForTests(
	implementation: TrashImplementation | undefined,
): void {
	testImplementation = implementation;
}

export function setBundledTrashHelpers(helpers: BundledTrashHelpers): void {
	bundledHelpers = helpers;
}

const execFileAsync = promisify(execFile);

function defaultTrashImplementation(): TrashImplementation {
	const helper =
		process.platform === "darwin"
			? bundledHelpers?.macos
			: process.platform === "win32"
				? bundledHelpers?.windows
				: undefined;
	if (!helper) return trash;
	return async (input) => {
		const paths = typeof input === "string" ? [input] : [...input];
		await Promise.all(paths.map((path) => execFileAsync(helper, [path], { windowsHide: true })));
	};
}

export async function trashFile(
	path: string,
	implementation: TrashImplementation = testImplementation ?? defaultTrashImplementation(),
): Promise<void> {
	await implementation(path, { glob: false });
}

function recoveryError(error: unknown, recovery: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(`${message} The claimed file was preserved at ${recovery}.`, { cause: error });
}

function restoreClaim(claim: string, path: string): void {
	const claimed = lstatSync(claim);
	if (claimed.isDirectory()) {
		renameSync(claim, path);
		return;
	}
	if (claimed.isSymbolicLink()) symlinkSync(readlinkSync(claim), path);
	else linkSync(claim, path);
	rmSync(claim, { force: true });
}

export async function claimAndTrashFile(
	path: string,
	claim: string,
	recovery: string,
): Promise<void> {
	renameSync(path, claim);
	try {
		await trashFile(claim);
	} catch (error) {
		try {
			restoreClaim(claim, path);
		} catch {
			renameSync(claim, recovery);
			throw recoveryError(error, recovery);
		}
		throw error;
	}
}
