import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_SCOPE = "default";

export function defaultDelegationRoot(): string {
	return join(getAgentDir(), "delegation");
}

export function delegationSessionDir(
	delegationRoot: string,
	scope: string,
	parentSessionId: string,
): string {
	return join(delegationRoot, scope, parentSessionId);
}

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
