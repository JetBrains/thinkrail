/**
 * The workspace auto-rename flow — the assist naming task's consumer, composing `agent` + `assist` +
 * `workspaces` (a composition only the host may make). `createServer` tees it off the session publisher
 * on every settled turn (`agent_end` with `willRetry: false`), fire-and-forget.
 *
 * Best-effort by contract: every failure path resolves `null` and leaves `Workspace.renamed` unset, so
 * a later settled turn retries; only a completed rename sets the flag. Never throws, never blocks a turn.
 */

import type { Message, PiEvent, Workspace } from "@thinkrail-pi/contracts";
import { getSessionMessages } from "../agent";
import { extractFirstTurn, suggestWorkspaceName } from "../assist";
import { getWorkspace, renameWorkspace } from "../workspaces";

/**
 * A settled turn: the run concluded and no auto-retry follows. `turn_end` is NOT settlement (it fires
 * once per provider round); `agent_end` with `willRetry: true` is followed by another run.
 */
export function isSettledTurn(event: PiEvent): boolean {
	return event.type === "agent_end" && !event.willRetry;
}

/**
 * Workspaces with a rename attempt in flight. `renamed` is not a mutex — it's only set on success, and
 * `agent_end` fires per turn *and* per session (a workspace can run several), so a second turn settling
 * during the one-shot's window would double-fire without this.
 */
const inFlight = new Set<string>();

/** Test seam: the hook's transcript source (defaults to `getSessionMessages` on the live session). */
export type TranscriptReader = () => Promise<Message[]>;

/**
 * Auto-name `workspaceId` off the session's first turn, if it's still eligible. Resolves the updated
 * `Workspace` for the caller to push on `workspace.updated`, or `null` when nothing happened.
 */
export async function maybeAutoRenameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript?: TranscriptReader,
): Promise<Workspace | null> {
	if (inFlight.has(workspaceId)) return null;
	let ws: Workspace;
	try {
		ws = getWorkspace(workspaceId);
	} catch {
		return null; // archived out from under the settling turn
	}
	if (ws.renamed) return null;

	inFlight.add(workspaceId);
	try {
		// The session transcript, not `agent_end.messages`: the event's array is run-local — an auto-retry
		// continuation run carries no user prompt at all, and a retry attempt would name from the wrong turn.
		// Killed (errored/aborted) turns are assist's problem: extractFirstTurn skips them, so a retracted
		// prompt can't become naming material even once a later turn settles cleanly.
		const read =
			readTranscript ??
			(async () => (await getSessionMessages(sessionId, workspaceId, ws.worktreePath)).messages);
		const messages = await read();

		const turn = extractFirstTurn(messages);
		if (!turn) return null;
		const slug = await suggestWorkspaceName(turn);
		if (!slug) return null;

		// Re-check across the awaits, then rename in the same synchronous tick — no interleaving possible
		// on this event loop between the check and the save (renameWorkspace is sync).
		const fresh = getWorkspace(workspaceId);
		if (fresh.renamed) return null;
		return renameWorkspace(workspaceId, slug);
	} catch (err) {
		// Best-effort means null, not silent: without the trace, a permanently-broken rename path would be
		// indistinguishable from the tolerated "assist had nothing to offer" case.
		console.warn(
			`workspace auto-rename skipped (${workspaceId}): ${err instanceof Error ? err.message : err}`,
		);
		return null;
	} finally {
		inFlight.delete(workspaceId);
	}
}
