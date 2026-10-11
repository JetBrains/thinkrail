import {
	getAgentDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ProjectTrustSummary } from "@thinkrail/contracts";
import { discoverAgentDefinitions } from "pi-subagents";
import { listProjectAliasSkillNames } from "./extensions";

export function piTrustsProjectPath(path: string): boolean {
	const agentDir = getAgentDir();
	try {
		const decision = new ProjectTrustStore(agentDir).get(path);
		if (decision !== null) return decision;
		const settings = SettingsManager.create(path, agentDir, { projectTrusted: false });
		return settings.getDefaultProjectTrust() === "always";
	} catch {
		return false;
	}
}

export async function projectTrustSummary(cwd: string): Promise<ProjectTrustSummary> {
	const agentDir = getAgentDir();
	const nativeResources =
		hasTrustRequiringProjectResources(cwd) ||
		discoverAgentDefinitions({ cwd, agentDir, includeProject: true }).some(
			(definition) => definition.source === "project",
		);
	return { aliasSkills: await listProjectAliasSkillNames(cwd), nativeResources };
}
