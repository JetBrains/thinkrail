import { type InlineEditRequest, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { buildSeedPrompt } from "./prompt";
import type { SelectionTarget } from "./types";

/** True if a not-yet-resolved request already exists for this file (one pending edit per file). */
export function hasPendingEditForPath(workspaceId: string, path: string): boolean {
	return Object.values(useAppStore.getState().inlineEdits).some(
		(r) => r.workspaceId === workspaceId && r.path === path && r.status !== "done",
	);
}

/**
 * Fire an inline edit: snapshot the file, create a hidden session, register the request, and fire-and-forget
 * the seed prompt (the create+prompt pattern used by the Welcome screen). Returns the requestId, or null if
 * create/read/prompt rejected (nothing is registered on failure).
 */
export async function startInlineEdit(
	target: SelectionTarget,
	instruction: string,
): Promise<string | null> {
	const store = useAppStore.getState();
	const transport = getTransport();
	try {
		const { content } = await transport.request("fs.readFile", {
			workspaceId: target.workspaceId,
			path: target.path,
		});
		const { sessionId, model, thinkingLevel } = await transport.request("session.create", {
			workspaceId: target.workspaceId,
		});
		const id = crypto.randomUUID();
		const req: InlineEditRequest = {
			id,
			workspaceId: target.workspaceId,
			path: target.path,
			sessionId,
			selection: { text: target.text, startLine: target.startLine, endLine: target.endLine },
			// turns[0].baseContent = the fire-time original (the Revert-all target).
			turns: [{ instruction, baseContent: content, hunks: [], pendingTools: {}, otherPaths: [] }],
			status: "working",
		};
		store.registerInlineEdit(req, model, thinkingLevel);
		// Fire-and-forget; a rejected send surfaces as the request's error status (streaming faults arrive as events).
		transport
			.request("session.prompt", { sessionId, text: buildSeedPrompt(target, instruction) })
			.catch((err) => useAppStore.getState().setInlineEditError(id, errorText(err)));
		return id;
	} catch (err) {
		// Create/read failed before anything was registered — the caller shows the popup error.
		console.warn("startInlineEdit failed:", errorText(err));
		return null;
	}
}

/** Refine: append a new turn (editing from the current on-disk content), then follow up on the same session. */
export async function refineInlineEdit(id: string, comment: string): Promise<void> {
	const req = useAppStore.getState().inlineEdits[id];
	if (!req) return;
	// The new turn edits from what's on disk now — its baseContent is the step-back target for a later Undo.
	const base = req.afterContent ?? req.turns.at(-1)?.baseContent ?? "";
	useAppStore.getState().pushInlineEditTurn(id, comment, base);
	getTransport()
		.request("session.followUp", { sessionId: req.sessionId, text: comment })
		.catch((err) => useAppStore.getState().setInlineEditError(id, errorText(err)));
}

/** Keep: the file already holds the edit — just resolve the request. */
export function keepInlineEdit(id: string): void {
	useAppStore.getState().removeInlineEdit(id);
}

/**
 * Write a saved content snapshot back to the target file (guarded by the last-read content), then re-read +
 * refresh the tab. Shared by Undo-last-change and Revert-all — the only difference is which snapshot and
 * what happens to the request afterward, handled by the callers below. Returns ok=false (staying in review)
 * on a write conflict.
 */
async function restoreSnapshot(
	id: string,
	content: string,
): Promise<{ ok: boolean; reason?: string }> {
	const store = useAppStore.getState();
	const req = store.inlineEdits[id];
	if (!req) return { ok: false, reason: "gone" };
	const guard = req.afterContent ?? content;
	store.setInlineEditStatus(id, "reverting");
	try {
		await getTransport().request("fs.writeFile", {
			workspaceId: req.workspaceId,
			path: req.path,
			content,
			ifMatchContent: guard,
		});
		// We just wrote `content`, so disk == content — sync the write guard so a *second* undo / a
		// revert-all-after-undo doesn't send a stale `ifMatchContent` and get spuriously rejected.
		useAppStore.getState().setInlineEditAfterContent(id, content);
		await refreshTabContent(req.workspaceId, req.path);
		return { ok: true };
	} catch (err) {
		store.setInlineEditStatus(id, "review");
		return { ok: false, reason: errorText(err) };
	}
}

/**
 * Undo-last-change: restore the current turn's `baseContent` (the state before this turn ran), then pop the
 * turn — back to reviewing the prior turn, or `done` if it was the only turn. Repeatable, one turn at a time.
 */
export async function undoLastChange(id: string): Promise<{ ok: boolean; reason?: string }> {
	const req = useAppStore.getState().inlineEdits[id];
	if (!req) return { ok: false, reason: "gone" };
	const current = req.turns.at(-1);
	if (!current) return { ok: false, reason: "gone" };
	const res = await restoreSnapshot(id, current.baseContent);
	if (!res.ok) return res;
	// Re-fetch after the await (state may have advanced) before deciding pop-vs-done.
	const live = useAppStore.getState().inlineEdits[id];
	if (live && live.turns.length > 1)
		useAppStore.getState().popInlineEditTurn(id); // → review of the prior turn
	else useAppStore.getState().removeInlineEdit(id); // only turn → fully reverted
	return res;
}

/** Revert-all: restore the fire-time original (`turns[0].baseContent`) and resolve. */
export async function revertAll(id: string): Promise<{ ok: boolean; reason?: string }> {
	const req = useAppStore.getState().inlineEdits[id];
	if (!req) return { ok: false, reason: "gone" };
	const original = req.turns[0]?.baseContent ?? req.afterContent ?? "";
	const res = await restoreSnapshot(id, original);
	if (res.ok) useAppStore.getState().removeInlineEdit(id);
	return res;
}

/** Stop a running edit: abort the session. Stays in review if the current turn produced hunks, else cancellable. */
export async function stopInlineEdit(id: string): Promise<void> {
	const req = useAppStore.getState().inlineEdits[id];
	if (!req) return;
	await getTransport()
		.request("session.abort", { sessionId: req.sessionId })
		.catch(() => {});
	const after = useAppStore.getState().inlineEdits[id];
	if (after && after.status === "working") {
		const hasHunks = (after.turns.at(-1)?.hunks.length ?? 0) > 0;
		if (hasHunks) useAppStore.getState().setInlineEditStatus(id, "review");
		else useAppStore.getState().removeInlineEdit(id); // cancelled (no edits landed) → drop it, don't leak
	}
}

/** Promote the hidden session to a normal chat tab (its runtime already holds the transcript). */
export function openInlineEditInTab(id: string): void {
	const store = useAppStore.getState();
	const req = store.inlineEdits[id];
	if (!req) return;
	const rt = store.sessions[req.sessionId];
	store.openChatSession(
		req.workspaceId,
		req.sessionId,
		rt?.model ?? null,
		rt?.thinkingLevel ?? "medium",
	);
}

/** Re-read a file and update any open tab's content (fixes the tab-staleness gap after an agent/revert write). */
export async function refreshTabContent(workspaceId: string, path: string): Promise<void> {
	try {
		const { content } = await getTransport().request("fs.readFile", { workspaceId, path });
		useAppStore.getState().updateFileTabContent(workspaceId, path, content);
	} catch {
		// leave the tab as-is on a read failure
	}
}
