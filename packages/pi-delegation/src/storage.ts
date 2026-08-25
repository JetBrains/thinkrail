// The delegation storage layout — V1 lineage IS this layout: hidden children persist under
// `<delegationRoot>/<scope>/<parentSessionId>/<timestamp>_<childSessionId>.jsonl`, never pi's
// default sessions root (hidden by construction: default-root listings never scan it). The
// directory structure is the parent edge; no index file until `listed` visibility lands.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** The pure-pi default storage partition key (an embedder binds its own, e.g. a workspace id). */
export const DEFAULT_SCOPE = "default";

/** The pure-pi default storage root (honors `PI_CODING_AGENT_DIR` via `getAgentDir`). */
export function defaultDelegationRoot(): string {
	return join(getAgentDir(), "delegation");
}

/** The session dir a parent's hidden children persist under — the lineage edge as a path. */
export function delegationSessionDir(
	delegationRoot: string,
	scope: string,
	parentSessionId: string,
): string {
	return join(delegationRoot, scope, parentSessionId);
}

/**
 * The transcript path without a live handle (post-restart reads). pi names session files
 * `<timestamp>_<sessionId>.jsonl` with a creation timestamp the ids don't carry, so this scans the
 * lineage dir for the child's suffix. Undefined when the dir or file doesn't exist.
 */
export function deriveChildSessionFile(
	delegationRoot: string,
	scope: string,
	parentSessionId: string,
	childSessionId: string,
): string | undefined {
	const dir = delegationSessionDir(delegationRoot, scope, parentSessionId);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return undefined;
	}
	const match = entries.find((name) => name.endsWith(`_${childSessionId}.jsonl`));
	return match ? join(dir, match) : undefined;
}
