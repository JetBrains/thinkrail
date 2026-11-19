import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SubagentCatalogEntry } from "@thinkrail/contracts";
import { discoverAgentDefinitions } from "pi-subagents";

export function listSubagentCatalog(cwd?: string, includeProject = false): SubagentCatalogEntry[] {
	return discoverAgentDefinitions({
		cwd: cwd ?? getAgentDir(),
		agentDir: getAgentDir(),
		includeProject: cwd !== undefined && includeProject,
	}).map(({ name, description, source, model, thinking }) => ({
		name,
		description,
		source,
		...(model === undefined ? {} : { model }),
		...(thinking === undefined ? {} : { thinking }),
	}));
}
