import { WORKSPACE_RENAME_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";

export function canRenameWorkspace(protocolVersion: number | null, workspace: Workspace): boolean {
	return (
		protocolVersion !== null &&
		protocolVersion >= WORKSPACE_RENAME_PROTOCOL_VERSION &&
		workspace.kind !== "default" &&
		workspace.kind !== "external"
	);
}

export function workspaceRenameValue(currentName: string, input: string): string | null {
	const name = input.trim();
	return name && name !== currentName ? name : null;
}
