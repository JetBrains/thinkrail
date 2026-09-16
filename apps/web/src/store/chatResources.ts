import type { SessionResources } from "@thinkrail/contracts";
import type { ConnectionStatus } from "../transport";

export interface ChatResourceScope {
	workspaceId: string;
	sessionId: string;
}

export interface ChatResourceRead extends ChatResourceScope {
	connectionGeneration: number;
	revision: number;
}

export interface ChatResourceProjection {
	snapshot: SessionResources | null;
	revision: number;
	connectionGeneration: number | null;
	fresh: boolean;
	error: string | null;
}

export type ChatResourceSnapshots = Record<string, Record<string, ChatResourceProjection>>;

export interface ChatResourceState {
	status: ConnectionStatus;
	protocolVersion: number | null;
	connectionGeneration: number;
	resourceSnapshots: ChatResourceSnapshots;
	removedWorkspaceIds: Record<string, true>;
	deletedSessionsByWorkspace: Record<string, Record<string, true>>;
}

export function staleChatResources(snapshots: ChatResourceSnapshots): ChatResourceSnapshots {
	return Object.fromEntries(
		Object.entries(snapshots).map(([workspaceId, sessions]) => [
			workspaceId,
			Object.fromEntries(
				Object.entries(sessions).map(([sessionId, projection]) => [
					sessionId,
					{ ...projection, fresh: false },
				]),
			),
		]),
	);
}
