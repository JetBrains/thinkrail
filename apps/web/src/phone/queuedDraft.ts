import type { ImageContent, SessionQueueContent } from "@thinkrail/contracts";

/** Queued messages put back in the field, as the IDE does when one is edited or a run is stopped. */
export function queuedDraft(
	current: string,
	content: SessionQueueContent,
): { text: string; images: ImageContent[] } {
	const messages = [...content.steering, ...content.followUp];
	const text = [...messages.map((message) => message.text), current]
		.filter((part) => part.trim() !== "")
		.join("\n\n");
	return { text, images: messages.flatMap((message) => message.images ?? []) };
}
