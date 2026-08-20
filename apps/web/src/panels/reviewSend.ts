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

function preferredChat(workspaceId: string): { sessionId?: string } {
	const sessionId = selectLastOpenChatSession(useAppStore.getState(), workspaceId);
	return sessionId ? { sessionId } : {};
}

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

export async function sendReviewBatch(workspaceId: string, commentIds?: string[]): Promise<void> {
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
	try {
		const { sessions } = await getTransport().request("review.sendBatch", {
			workspaceId,
			...(commentIds ? { commentIds } : {}),
			...preferredChat(workspaceId),
		});
		for (const [index, sent] of sessions.entries()) {
			await showReviewChat(workspaceId, sent, navigation, index > 0);
		}
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the review");
		throw err;
	}
}
