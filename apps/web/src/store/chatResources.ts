import {
	compareResourceHistory,
	isLiveResource,
	type ResourceKind,
	type ResourceRecord,
	resourceHistoryCursor,
	resourceRecordId,
	type SessionResources,
} from "@thinkrail/contracts";
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
	older?: readonly ResourceRecord[];
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

function snapshotRecords(snapshot: SessionResources | null | undefined): ResourceRecord[] {
	return [
		...(snapshot?.commands ?? []).map((summary): ResourceRecord => ({ kind: "command", summary })),
		...(snapshot?.subagents ?? []).map(
			(summary): ResourceRecord => ({ kind: "subagent", summary }),
		),
	];
}

function newestFirst(records: ResourceRecord[]): ResourceRecord[] {
	return records.sort((a, b) =>
		compareResourceHistory(resourceHistoryCursor(a), resourceHistoryCursor(b)),
	);
}

export function finishedChain(
	projection: Pick<ChatResourceProjection, "snapshot" | "older"> | undefined,
	kind: ResourceKind,
): ResourceRecord[] {
	const current = snapshotRecords(projection?.snapshot).filter((record) => record.kind === kind);
	const held = new Set(current.map(resourceRecordId));
	const older = (projection?.older ?? []).filter(
		(record) => record.kind === kind && !held.has(resourceRecordId(record)),
	);
	return [...newestFirst(current.filter((record) => !isLiveResource(record))), ...older];
}

export function carryOlderResources(
	previous: ChatResourceProjection | undefined,
	next: SessionResources,
): readonly ResourceRecord[] | undefined {
	const carried = (["command", "subagent"] as const).flatMap((kind) => {
		if (!previous?.older?.some((record) => record.kind === kind)) return [];
		const chain = finishedChain(previous, kind);
		const window = finishedChain({ snapshot: next }, kind);
		const oldest = window.at(-1);
		const at = oldest
			? chain.findIndex((record) => resourceRecordId(record) === resourceRecordId(oldest))
			: -1;
		if (at === -1) return [];
		const taken = new Set(
			snapshotRecords(next)
				.filter((record) => record.kind === kind)
				.map(resourceRecordId),
		);
		return chain.slice(at + 1).filter((record) => !taken.has(resourceRecordId(record)));
	});
	return carried.length > 0 ? carried : undefined;
}

export function appendOlderResources(
	projection: ChatResourceProjection,
	kind: ResourceKind,
	after: string,
	page: readonly ResourceRecord[],
): readonly ResourceRecord[] | null {
	const chain = finishedChain(projection, kind);
	const last = chain.at(-1);
	if (!last || resourceRecordId(last) !== after) return null;
	const known = new Set([
		...chain.map(resourceRecordId),
		...snapshotRecords(projection.snapshot).map(resourceRecordId),
	]);
	return [
		...(projection.older ?? []),
		...page.filter((record) => record.kind === kind && !known.has(resourceRecordId(record))),
	];
}
