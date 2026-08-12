/// <reference path="./procfs.d.ts" />

import procfsParsers from "@stroncium/procfs/lib/parsers";
import processMountinfo from "@stroncium/procfs/lib/parsers/processMountinfo";
import trash from "trash";

// `trash`'s Linux path asks procfs for this parser through a template-literal CommonJS require. A source
// run resolves it from node_modules, but Bun cannot discover that edge for a single-file binary. Statically
// include the parser and install the same lazy-getter result as an own property before trash ever calls it.
if (!Object.hasOwn(procfsParsers, "processMountinfo")) {
	Object.defineProperty(procfsParsers, "processMountinfo", { value: processMountinfo });
}

export type TrashImplementation = (
	input: string | readonly string[],
	options?: { readonly glob?: boolean },
) => Promise<void>;

/** Move one literal path to the OS trash. Failures propagate; a recoverable action never falls back to unlink. */
export async function trashFile(
	path: string,
	implementation: TrashImplementation = trash,
): Promise<void> {
	await implementation(path, { glob: false });
}
