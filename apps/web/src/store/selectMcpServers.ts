import type { McpRead, McpWorkspaceProjection } from "./mcp";
import { selectSupportsMcp } from "./selectors";

export function selectMcpRead(
	state: {
		status: string;
		protocolVersion: number | null;
		connectionGeneration: number;
		mcpRevision: number;
		removedWorkspaceIds: Record<string, true>;
	},
	workspaceId: string,
): McpRead | null {
	if (
		state.status !== "connected" ||
		!selectSupportsMcp(state) ||
		state.removedWorkspaceIds[workspaceId]
	) {
		return null;
	}
	return {
		workspaceId,
		connectionGeneration: state.connectionGeneration,
		revision: state.mcpRevision,
	};
}

export function selectMcpWorkspaceStarting(
	state: { mcpByWorkspace: Record<string, McpWorkspaceProjection> },
	workspaceId: string,
): boolean {
	return Object.values(state.mcpByWorkspace[workspaceId]?.sessions ?? {}).some((held) =>
		held.snapshot.servers.some((server) => server.state === "starting"),
	);
}
