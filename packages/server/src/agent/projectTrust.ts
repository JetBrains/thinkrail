import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getAgentDir, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ProjectResourceKind, ProjectTrustSummary } from "@thinkrail/contracts";
import { discoverAgentDefinitions } from "pi-subagents";
import { listProjectAliasSkillNames } from "./extensions";
import { loadMcpConfigFiles } from "./mcp";

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

const PI_DIR_RESOURCES: ReadonlyArray<[ProjectResourceKind, string]> = [
	["extensions", "extensions"],
	["settings", "settings.json"],
	["skills", "skills"],
	["prompts", "prompts"],
	["themes", "themes"],
	["systemPrompt", "SYSTEM.md"],
	["systemPrompt", "APPEND_SYSTEM.md"],
];

function canonical(path: string): string {
	try {
		return realpathSync(resolve(path));
	} catch {
		return resolve(path);
	}
}

function hasAncestorAgentsSkills(cwd: string): boolean {
	const personal = join(canonical(process.env.HOME || homedir()), ".agents", "skills");
	for (let dir = canonical(cwd); ; dir = dirname(dir)) {
		const candidate = join(dir, ".agents", "skills");
		if (candidate !== personal && existsSync(candidate)) return true;
		if (dirname(dir) === dir) return false;
	}
}

function piResourceKinds(cwd: string): ProjectResourceKind[] {
	const piDir = join(canonical(cwd), ".pi");
	const kinds = new Set<ProjectResourceKind>();
	for (const [kind, entry] of PI_DIR_RESOURCES) if (existsSync(join(piDir, entry))) kinds.add(kind);
	if (hasAncestorAgentsSkills(cwd)) kinds.add("skills");
	const definitions = discoverAgentDefinitions({
		cwd,
		agentDir: getAgentDir(),
		includeProject: true,
	});
	if (definitions.some((definition) => definition.source === "project")) kinds.add("subagents");
	return [...kinds];
}

export async function projectTrustSummary(cwd: string): Promise<ProjectTrustSummary> {
	const mcpServers = loadMcpConfigFiles({
		agentDir: getAgentDir(),
		cwd,
		projectTrusted: true,
	}).entries.filter((entry) => entry.scope === "project").length;
	return {
		aliasSkills: await listProjectAliasSkillNames(cwd),
		piResources: piResourceKinds(cwd),
		mcpServers,
	};
}
