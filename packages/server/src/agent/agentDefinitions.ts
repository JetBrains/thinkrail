import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Installs a host-owned personal subagent definition. A file the user wrote or edited (one without
 * `marker`) is never touched; a file carrying `marker` is refreshed when its text changed.
 */
export function ensureManagedAgentDefinition(
	name: string,
	definition: string,
	marker: string,
	agentDir: string = getAgentDir(),
): void {
	const dir = join(agentDir, "agents");
	const file = join(dir, `${name}.md`);
	if (existsSync(file)) {
		const current = readFileSync(file, "utf8");
		if (!current.includes(marker) || current === definition) return;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, definition);
}
