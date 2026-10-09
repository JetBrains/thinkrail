import type {
	McpConfigFileError,
	McpListResult,
	McpServerSummary,
	McpStatusSnapshot,
} from "@thinkrail/contracts";

export interface McpRead {
	workspaceId: string;
	connectionGeneration: number;
	revision: number;
}

export interface McpHeldSnapshot {
	snapshot: McpStatusSnapshot;
	connectionGeneration: number;
	revision: number;
}

export interface McpWorkspaceProjection {
	servers: McpServerSummary[] | null;
	configErrors: McpConfigFileError[];
	handledElsewhere: { by: string } | null;
	sessions: Record<string, McpHeldSnapshot>;
}

export const EMPTY_MCP_PROJECTION: McpWorkspaceProjection = {
	servers: null,
	configErrors: [],
	handledElsewhere: null,
	sessions: {},
};

export function isNewerMcpSnapshot(
	held: McpHeldSnapshot | undefined,
	snapshot: McpStatusSnapshot,
	connectionGeneration: number,
): boolean {
	if (!held || held.connectionGeneration < connectionGeneration) return true;
	return (
		held.connectionGeneration === connectionGeneration &&
		snapshot.generation > held.snapshot.generation
	);
}

export function foldMcpSnapshot(
	held: McpHeldSnapshot | undefined,
	snapshot: McpStatusSnapshot,
	connectionGeneration: number,
	revision: number,
): McpHeldSnapshot | null {
	if (!isNewerMcpSnapshot(held, snapshot, connectionGeneration)) return null;
	return { snapshot, connectionGeneration, revision };
}

export function foldMcpList(
	projection: McpWorkspaceProjection | undefined,
	result: McpListResult,
	read: McpRead,
): McpWorkspaceProjection {
	const held = projection?.sessions ?? {};
	const sessions: Record<string, McpHeldSnapshot> = {};
	for (const [sessionId, snapshot] of Object.entries(held)) {
		if (snapshot.revision > read.revision) sessions[sessionId] = snapshot;
	}
	for (const snapshot of result.statuses) {
		if (snapshot.workspaceId !== read.workspaceId) continue;
		const previous = held[snapshot.sessionId];
		const folded = foldMcpSnapshot(previous, snapshot, read.connectionGeneration, read.revision);
		if (folded) sessions[snapshot.sessionId] = folded;
		else if (previous) sessions[snapshot.sessionId] = previous;
	}
	return {
		servers: result.servers,
		configErrors: result.configErrors ?? [],
		handledElsewhere: result.handledElsewhere ?? null,
		sessions,
	};
}

export function withoutMcpSession(
	byWorkspace: Record<string, McpWorkspaceProjection>,
	workspaceId: string,
	sessionId: string,
): Record<string, McpWorkspaceProjection> {
	const projection = byWorkspace[workspaceId];
	if (!projection?.sessions[sessionId]) return byWorkspace;
	const { [sessionId]: _dropped, ...sessions } = projection.sessions;
	return { ...byWorkspace, [workspaceId]: { ...projection, sessions } };
}
