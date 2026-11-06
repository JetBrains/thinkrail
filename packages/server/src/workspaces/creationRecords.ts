import { isAbsolute, relative } from "node:path";
import type { WorkspaceCreation, WorkspaceCreationRemoved } from "@thinkrail/contracts";
import { canonicalPath } from "../git";
import {
	loadWorkspaceCreations,
	saveWorkspaceCreations,
	type WorkspaceCreationRecord,
} from "../persistence";

export type WorkspaceCreationEvent =
	| { kind: "changed"; creation: WorkspaceCreation }
	| { kind: "removed"; removed: WorkspaceCreationRemoved };

let publishCreation: ((event: WorkspaceCreationEvent) => void) | null = null;

export function setWorkspaceCreationPublisher(
	fn: ((event: WorkspaceCreationEvent) => void) | null,
): void {
	publishCreation = fn;
}

export function emitCreation(event: WorkspaceCreationEvent): void {
	publishCreation?.(event);
}

export function creationView(record: WorkspaceCreationRecord): WorkspaceCreation {
	return {
		id: record.id,
		projectId: record.projectId,
		name: record.name,
		branch: record.branch,
		baseBranch: record.baseBranch,
		state: record.state,
		phase: record.phase,
		startedAt: record.startedAt,
		...(record.progress ? { progress: record.progress } : {}),
		...(record.failure ? { failure: record.failure } : {}),
		...(record.kickoff
			? {
					kickoff: {
						text: record.kickoff.text,
						imageCount: record.kickoff.images?.length ?? 0,
					},
				}
			: {}),
	};
}

export function creationRecords(): WorkspaceCreationRecord[] {
	return loadWorkspaceCreations();
}

export function findCreation(id: string): WorkspaceCreationRecord | undefined {
	return loadWorkspaceCreations().find((record) => record.id === id);
}

export function addCreation(record: WorkspaceCreationRecord): void {
	saveWorkspaceCreations([...loadWorkspaceCreations(), record]);
	emitCreation({ kind: "changed", creation: creationView(record) });
}

export function updateCreation(
	id: string,
	mutate: (record: WorkspaceCreationRecord) => void,
	opts: { emit?: boolean } = {},
): WorkspaceCreationRecord {
	const all = loadWorkspaceCreations();
	const record = all.find((candidate) => candidate.id === id);
	if (!record) throw new Error(`Unknown workspace creation: ${id}`);
	mutate(record);
	saveWorkspaceCreations(all);
	if (opts.emit !== false) emitCreation({ kind: "changed", creation: creationView(record) });
	return record;
}

export function deleteCreation(id: string): WorkspaceCreationRecord | undefined {
	const all = loadWorkspaceCreations();
	const record = all.find((candidate) => candidate.id === id);
	if (!record) return undefined;
	saveWorkspaceCreations(all.filter((candidate) => candidate !== record));
	return record;
}

export function creationOwnsPath(path: string): boolean {
	const wanted = canonicalPath(path);
	return loadWorkspaceCreations().some((record) => {
		const rel = relative(canonicalPath(record.worktreePath), wanted);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

export function creationBranchReserved(projectId: string, branch: string): boolean {
	return loadWorkspaceCreations().some(
		(record) => record.projectId === projectId && record.branch === branch,
	);
}

export function repointCreationBases(projectId: string, from: string, to: string): void {
	const all = loadWorkspaceCreations();
	const changed = all.filter(
		(record) => record.projectId === projectId && record.baseBranch === from,
	);
	if (changed.length === 0) return;
	for (const record of changed) record.baseBranch = to;
	saveWorkspaceCreations(all);
	for (const record of changed) emitCreation({ kind: "changed", creation: creationView(record) });
}
