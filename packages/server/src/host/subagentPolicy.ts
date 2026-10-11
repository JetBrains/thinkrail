import {
	isSubagentMaxConcurrent,
	SUBAGENT_MAX_CONCURRENT,
	type Workspace,
} from "@thinkrail/contracts";

export function resolveSubagentsEnabled(
	globalDefault: boolean,
	workspace: Pick<Workspace, "subagentsOverride"> | undefined,
): boolean {
	if (!workspace) return false;
	if (workspace.subagentsOverride === "on") return true;
	if (workspace.subagentsOverride === "off") return false;
	return globalDefault;
}

export function resolveSubagentMaxConcurrent(
	globalDefault: number,
	workspace: Pick<Workspace, "subagentMaxConcurrentOverride"> | undefined,
): number {
	const override = workspace?.subagentMaxConcurrentOverride;
	if (isSubagentMaxConcurrent(override)) return override;
	return isSubagentMaxConcurrent(globalDefault) ? globalDefault : SUBAGENT_MAX_CONCURRENT.default;
}
