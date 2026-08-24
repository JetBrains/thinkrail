import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { diffBaseRef } from "../git";
import { listWorkspaceRecords } from "../workspaces";

type FsNudgePublisher = (payload: WorkspaceFsChangedPayload) => void;

let publish: FsNudgePublisher | null = null;

export function setFsNudgePublisher(publisher: FsNudgePublisher | null): void {
	publish = publisher;
}

export function nudgeBaseRefWorkspaces(projectId: string, ref: string): void {
	if (!publish) return;
	for (const ws of listWorkspaceRecords(projectId)) {
		if (diffBaseRef(ws) === ref)
			publish({ workspaceId: ws.id, paths: [], truncated: false, skillChange: "none" });
	}
}
