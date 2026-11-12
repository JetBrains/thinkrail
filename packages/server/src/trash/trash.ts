/// <reference path="./procfs.d.ts" />

import { execFile } from "node:child_process";
import {
	linkSync,
	lstatSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import processMountinfo from "@stroncium/procfs/lib/parsers/processMountinfo.js";
import procfsParsers from "@stroncium/procfs/lib/parsers.js";
import { CodedError } from "@thinkrail/shared/codedError";
import trash from "trash";

if (!Object.hasOwn(procfsParsers, "processMountinfo")) {
	Object.defineProperty(procfsParsers, "processMountinfo", { value: processMountinfo });
}

export type TrashImplementation = (
	input: string | readonly string[],
	options?: { readonly glob?: boolean },
) => Promise<void>;

export interface ClaimedEntry {
	readonly parent: string;
	readonly dev: bigint;
	readonly ino: bigint;
}

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

function assertClaimed(claim: string, expected: ClaimedEntry): void {
	const claimed = lstatSync(claim, { bigint: true });
	if (
		claimed.dev !== expected.dev ||
		claimed.ino !== expected.ino ||
		realpathSync(dirname(claim)) !== expected.parent
	) {
		throw new CodedError(
			"ENTRY_CHANGED",
			"The entry changed while it was being moved to the trash, so it was left in place.",
		);
	}
}

export async function claimAndTrashFile(
	path: string,
	claim: string,
	recovery: string,
	expected: ClaimedEntry,
): Promise<void> {
	renameSync(path, claim);
	try {
		assertClaimed(claim, expected);
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
