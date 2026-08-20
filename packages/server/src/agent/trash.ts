/// <reference path="./procfs.d.ts" />

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import procfsParsers from "@stroncium/procfs/lib/parsers";
import processMountinfo from "@stroncium/procfs/lib/parsers/processMountinfo";
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
		await Promise.all(paths.map((path) => execFileAsync(helper, [path])));
	};
}

export async function trashFile(
	path: string,
	implementation: TrashImplementation = testImplementation ?? defaultTrashImplementation(),
): Promise<void> {
	await implementation(path, { glob: false });
}
