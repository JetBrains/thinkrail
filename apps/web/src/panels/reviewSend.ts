// The ONE send implementation behind every review-send affordance: the sidebar's per-row Send +
// "Send review (N)", the inline thread cards' Send, the composer's "Send now" (via
// `useReviewCommenting`), and the tab strip's "Send all". Each creates/reuses the session host-side,
// then opens its chat tab; a failure toasts and rethrows so callers can keep their UI open.

import type { ReviewSendResult } from "@thinkrail/contracts";
import {
	type CenterNavigationStamp,
	layoutOpenOptionsForNavigation,
	selectLastOpenChatSession,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { openChatInTab } from "./openChat";

/**
 * Show the chat a send landed in. A chat this call CREATED is opened straight from the result (no
 * round-trip, and its runtime exists before the first streamed event); a **reused** one goes through the
 * shared tab→runtime→disk escalation instead — it may be a chat this client has never seen (a second
 * client, or this one after a reload), and opening that as new would show a blank conversation for
 * comments already marked sent.
 */
async function showReviewChat(
	workspaceId: string,
	sent: ReviewSendResult,
	navigation: CenterNavigationStamp | null,
	background = false,
): Promise<void> {
	if (sent.reused) {
		await openChatInTab(workspaceId, sent.sessionId, navigation, background);
		return;
	}
	const store = useAppStore.getState();
	const routed = layoutOpenOptionsForNavigation(store, workspaceId, navigation);
	store.openChatSession(
		workspaceId,
		sent.sessionId,
		sent.model,
		sent.thinkingLevel,
		undefined,
		background ? { ...routed, activate: false } : routed,
	);
}

/** The send target the client prefers: the last OPEN chat (active tab first) — the package lands in
 * the conversation already on screen; only a workspace with no open chat gets a fresh one. */
function preferredChat(workspaceId: string): { sessionId?: string } {
	const sessionId = selectLastOpenChatSession(useAppStore.getState(), workspaceId);
	return sessionId ? { sessionId } : {};
}

/** Send ONE draft into the last open chat (or the file's review chat / a new one) and open its tab. */
export async function sendReviewComment(workspaceId: string, id: string): Promise<void> {
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
	try {
		const sent = await getTransport().request("review.sendComment", {
			workspaceId,
			id,
			...preferredChat(workspaceId),
		});
		await showReviewChat(workspaceId, sent, navigation);
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the comment");
		throw err;
	}
}

/** Send the given drafts (or all) as one batch — the host groups them into per-file review chats —
 * and open the (first) chat's tab. */
export async function sendReviewBatch(workspaceId: string, commentIds?: string[]): Promise<void> {
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
	try {
		const { sessions } = await getTransport().request("review.sendBatch", {
			workspaceId,
			...(commentIds ? { commentIds } : {}),
			...preferredChat(workspaceId),
		});
		// One chat per group, so a batch spanning files opens EVERY chat it started — a tab the user
		// never saw would still be an agent working on their comments. The first group's chat may take
		// the request-time focus (unless newer navigation won); the rest open in the background.
		for (const [index, sent] of sessions.entries()) {
			await showReviewChat(workspaceId, sent, navigation, index > 0);
		}
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the review");
		throw err;
	}
}
