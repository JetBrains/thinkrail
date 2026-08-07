// The ONE send implementation behind every review-send affordance: the sidebar's per-row Send +
// "Send review (N)", the inline thread cards' Send, the composer's "Send now" (via
// `useReviewCommenting`), and the tab strip's "Send all". Each creates/reuses the session host-side,
// then opens its chat tab; a failure toasts and rethrows so callers can keep their UI open.

import type { ReviewSendResult } from "@thinkrail/contracts";
import { selectLastOpenChatSession, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { openChatInTab } from "./openChat";

/**
 * Show the chat a send landed in. A chat this call CREATED is opened straight from the result (no
 * round-trip, and its runtime exists before the first streamed event); a **reused** one goes through the
 * shared tab→runtime→disk escalation instead — it may be a chat this client has never seen (a second
 * client, or this one after a reload), and opening that as new would show a blank conversation for
 * comments already marked sent.
 */
async function showReviewChat(workspaceId: string, sent: ReviewSendResult): Promise<void> {
	if (sent.reused) {
		await openChatInTab(workspaceId, sent.sessionId);
		return;
	}
	useAppStore
		.getState()
		.openChatSession(workspaceId, sent.sessionId, sent.model, sent.thinkingLevel);
}

/** The send target the client prefers: the last OPEN chat (active tab first) — the package lands in
 * the conversation already on screen; only a workspace with no open chat gets a fresh one. */
function preferredChat(workspaceId: string): { sessionId?: string } {
	const sessionId = selectLastOpenChatSession(useAppStore.getState(), workspaceId);
	return sessionId ? { sessionId } : {};
}

/** Send ONE draft into the last open chat (or the file's review chat / a new one) and open its tab. */
export async function sendReviewComment(workspaceId: string, id: string): Promise<void> {
	try {
		const sent = await getTransport().request("review.sendComment", {
			workspaceId,
			id,
			...preferredChat(workspaceId),
		});
		await showReviewChat(workspaceId, sent);
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the comment");
		throw err;
	}
}

/** Send the given drafts (or all) as one batch — the host groups them into per-file review chats —
 * and open the (first) chat's tab. */
export async function sendReviewBatch(workspaceId: string, commentIds?: string[]): Promise<void> {
	try {
		const { sessions } = await getTransport().request("review.sendBatch", {
			workspaceId,
			...(commentIds ? { commentIds } : {}),
			...preferredChat(workspaceId),
		});
		// One chat per group, so a batch spanning files opens EVERY chat it started — a tab the user
		// never saw would still be an agent working on their comments. The first group's chat takes
		// focus (it's the one the click was about); the rest sit in the strip.
		for (const sent of sessions) await showReviewChat(workspaceId, sent);
		const first = sessions[0];
		if (first && sessions.length > 1) await openChatInTab(workspaceId, first.sessionId);
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the review");
		throw err;
	}
}
