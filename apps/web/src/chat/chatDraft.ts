import { withRestoredDraft } from "@thinkrail/chat-ui/attachments";
import type { ComposerHandle } from "@thinkrail/chat-ui/Composer";
import type { ImageContent, SessionQueueContent } from "@thinkrail/contracts";
import { selectCompactionTurnIds, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

const PARAGRAPH = "\n\n";
const nonBlank = (part: string): boolean => part.trim() !== "";

/** Queued messages as one draft: their non-blank texts as paragraphs, and every image. */
export function queuedDraft(content: SessionQueueContent): {
	text: string;
	images: ImageContent[];
} {
	const messages = [...content.steering, ...content.followUp];
	return {
		text: messages
			.map((message) => message.text)
			.filter(nonBlank)
			.join(PARAGRAPH),
		images: messages.flatMap((message) => message.images ?? []),
	};
}

/** Puts text back in a chat's draft ahead of what is typed there, and focuses the field. */
export function restoreTextToDraft(
	sessionId: string,
	text: string,
	composer: ComposerHandle | null,
): void {
	if (!nonBlank(text)) return;
	const store = useAppStore.getState();
	store.setChatDraft(sessionId, withRestoredDraft(text, store.sessions[sessionId]?.draft ?? ""));
	composer?.refocus();
}

/** Puts queued (or unsent) messages back in a chat's field: their text in the draft, their images attached. */
export function restoreQueueToDraft(
	sessionId: string,
	content: SessionQueueContent,
	composer: ComposerHandle | null,
): void {
	const restored = queuedDraft(content);
	restoreTextToDraft(sessionId, restored.text, composer);
	composer?.restoreAttachments(
		restored.images.map((image, index) => ({ name: `queued-image-${index + 1}`, content: image })),
	);
}

/** `/compact`: the queue goes back in the field first, and a failure lands in the transcript unless pi reported it. */
export function compactChat(
	sessionId: string,
	instructions: string | undefined,
	composer: ComposerHandle | null,
): void {
	const observedTurnIds = selectCompactionTurnIds(useAppStore.getState(), sessionId);
	void getTransport()
		.request("session.clearQueue", { sessionId, requireTextOnly: true })
		.then((content) => {
			restoreQueueToDraft(sessionId, content, composer);
			return getTransport().request("session.compact", {
				sessionId,
				...(instructions ? { instructions } : {}),
			});
		})
		.catch((error: unknown) =>
			useAppStore
				.getState()
				.appendCompactionFailureUnlessObserved(sessionId, observedTurnIds, errorText(error)),
		);
}

/** `/name`: renames the chat, a failure landing in the transcript. */
export function renameChat(workspaceId: string, sessionId: string, title: string): void {
	void getTransport()
		.request("session.rename", { workspaceId, sessionId, title })
		.catch((error: unknown) => useAppStore.getState().appendErrorTurn(sessionId, errorText(error)));
}
