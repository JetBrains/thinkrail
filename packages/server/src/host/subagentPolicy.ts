import type { Workspace } from "@thinkrail/contracts";

export function resolveSubagentsEnabled(
	globalDefault: boolean,
	workspace: Pick<Workspace, "subagentsOverride"> | undefined,
): boolean {
	if (!workspace) return false;
	if (workspace.subagentsOverride === "on") return true;
	if (workspace.subagentsOverride === "off") return false;
	return globalDefault;
}
