import {
	getAgentDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import type { ProjectTrustSummary } from "@thinkrail/contracts";
import { discoverAgentDefinitions } from "pi-subagents";
import { listProjectAliasSkillNames } from "./extensions";
import { loadMcpConfigFiles } from "./mcp";

export function piProjectTrustDecision(path: string): boolean | null | undefined {
	try {
		return new ProjectTrustStore(getAgentDir()).get(path);
	} catch {
		return undefined;
	}
}

export async function projectTrustSummary(cwd: string): Promise<ProjectTrustSummary> {
	const agentDir = getAgentDir();
	const nativeResources =
		hasTrustRequiringProjectResources(cwd) ||
		discoverAgentDefinitions({ cwd, agentDir, includeProject: true }).some(
			(definition) => definition.source === "project",
		);
	const mcpServers = loadMcpConfigFiles({ agentDir, cwd, projectTrusted: true }).entries.filter(
		(entry) => entry.scope === "project",
	).length;
	return { aliasSkills: await listProjectAliasSkillNames(cwd), nativeResources, mcpServers };
}
