import type { Workspace } from "@thinkrail/contracts";
import { removeWorkspaceSessions } from "../agent";
import { removeWorkspaceArtifacts } from "../artifacts";
import { forgetWorkspaceChanges } from "../changes";
import { logger } from "../log";
import { removeWorkspaceReviews } from "../reviews";
import { evictSpecIndex, evictSpecRoot } from "../spec";
import { closeWorkspaceTerminals } from "../terminal";
import { settleChangeArtifacts } from "../todos";
import { forgetWorkspaceTurns } from "../turns";
import { stopWatch } from "../watch";
import { forgetWorkspace, reclaimWorktree } from "../workspaces";

const log = logger("host");

async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		await settleChangeArtifacts(ws.id);
		await reclaimWorktree(ws);
	} catch {
		log.warn(`workspace archive teardown failed for ${ws.id}`);
	}
}

/** `workspace.remove`: the record and every in-memory owner go now; sessions and the worktree are reclaimed in the background. */
export function archiveWorkspace(id: string): void {
	const ws = forgetWorkspace(id);
	if (!ws) return;
	evictSpecIndex(ws.id);
	evictSpecRoot(ws.worktreePath);
	removeWorkspaceReviews(ws.id);
	forgetWorkspaceChanges(ws.id);
	forgetWorkspaceTurns(ws.id);
	removeWorkspaceArtifacts(ws.id);
	stopWatch(ws.id);
	closeWorkspaceTerminals(ws.id);
	void archiveTeardown(ws);
}
