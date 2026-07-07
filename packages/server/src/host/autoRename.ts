/**
 * The workspace auto-rename flow — the assist naming task's consumer, composing `agent` + `assist` +
 * `workspaces` (a composition only the host may make), in two fire-and-forget passes `createServer` tees
 * off the session publisher: an **instant naive** name when the first prompt lands
 * ({@link maybeNaiveNameWorkspace}, on {@link isPromptCommitted}) and an **agentic refine** on the settled
 * turn ({@link maybeAutoRenameWorkspace}, on {@link isSettledTurn} — `agent_end` with `willRetry: false`).
 *
 * Best-effort by contract: every failure path resolves `null`. The naive pass renames provisionally
 * (leaves `renamed` unset) so the agentic pass still refines; only the agentic (or user) rename sets the
 * flag, and while it's unset a later settled turn retries. Never throws, never blocks a turn.
 */

import type { Message, PiEvent, Workspace } from "@thinkrail/contracts";
import { getSessionMessages } from "../agent";
import { extractFirstTurn, naiveWorkspaceSlug, suggestWorkspaceName } from "../assist";
import { getWorkspace, renameWorkspace } from "../workspaces";

/** A pristine, never-touched auto name (`workspace-N`) — the only state the naive pass may overwrite. */
const PRISTINE_NAME = /^workspace-\d+$/;

/**
 * A settled turn: the run concluded and no auto-retry follows. `turn_end` is NOT settlement (it fires
 * once per provider round); `agent_end` with `willRetry: true` is followed by another run.
 */
export function isSettledTurn(event: PiEvent): boolean {
	return event.type === "agent_end" && !event.willRetry;
}

/**
 * The moment a user prompt has entered the transcript: `message_end` for a user message. The agent loop
 * emits `agent_start` and `turn_start` *before* the prompt's `message_end`, so those are too early —
 * `getSessionMessages` wouldn't see the prompt yet. This still fires before the model responds (before any
 * tool/question can block), so the naive name is instant.
 */
export function isPromptCommitted(event: PiEvent): boolean {
	return event.type === "message_end" && event.message.role === "user";
}

/**
 * Workspaces with a rename attempt in flight. `renamed` is not a mutex — it's only set on success, and
 * `agent_end` fires per turn *and* per session (a workspace can run several), so a second turn settling
 * during the one-shot's window would double-fire without this.
 */
const inFlight = new Set<string>();

/**
 * Workspaces with a *naive* rename in flight. Independent of {@link inFlight}: the naive pass (first
 * prompt) and the agentic pass (turn settle) can legitimately overlap on a short turn, and each dedupes only
 * against its own re-fires (a second user `message_end` can arrive before the first naive rename lands).
 */
const naiveInFlight = new Set<string>();

/** Test seam: the hook's transcript source (defaults to `getSessionMessages` on the live session). */
export type TranscriptReader = () => Promise<Message[]>;

/**
 * Instantly name `workspaceId` from the session's first prompt, **non-agentically** — a cheap provisional
 * slug shown the moment the first prompt lands, so a long first turn no longer leaves the workspace as
 * `workspace-N` for minutes while the agentic pass waits for the turn to settle.
 *
 * Provisional by contract: it renames name + branch but leaves `renamed` unset (`lock: false`), so
 * {@link maybeAutoRenameWorkspace} still refines the slug into a final name and locks it on settle. It
 * fires only on a **pristine** workspace (`!renamed` AND name still `workspace-N`) — once the naive slug
 * lands the name no longer matches, so it never fires twice and never overwrites a user/agentic name.
 * Best-effort like the agentic pass: every failure path resolves `null`; never throws, never blocks.
 */
export async function maybeNaiveNameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript?: TranscriptReader,
): Promise<Workspace | null> {
	if (naiveInFlight.has(workspaceId)) return null;
	if (!isPristine(workspaceId)) return null;

	naiveInFlight.add(workspaceId);
	try {
		const read =
			readTranscript ??
			(async () =>
				(await getSessionMessages(sessionId, workspaceId, getWorkspace(workspaceId).worktreePath))
					.messages);
		const turn = extractFirstTurn(await read());
		if (!turn) return null;
		const slug = naiveWorkspaceSlug(turn.prompt);
		if (!slug) return null;

		// Re-check across the await, then rename in the same synchronous tick. `lock: false` keeps the
		// workspace eligible for the agentic refinement that follows on the settled turn.
		if (!isPristine(workspaceId)) return null;
		return renameWorkspace(workspaceId, slug, { lock: false });
	} catch (err) {
		console.warn(
			`workspace naive-rename skipped (${workspaceId}): ${err instanceof Error ? err.message : err}`,
		);
		return null;
	} finally {
		naiveInFlight.delete(workspaceId);
	}
}

/** A workspace still carrying its pristine auto name (`workspace-N`, never renamed). `false` if gone. */
function isPristine(workspaceId: string): boolean {
	try {
		const ws = getWorkspace(workspaceId);
		return !ws.renamed && PRISTINE_NAME.test(ws.name);
	} catch {
		return false; // archived out from under the starting turn
	}
}

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
