import type { ImageContent, SessionQueueContent } from "@thinkrail/contracts";

const PARAGRAPH = "\n\n";
const nonBlank = (part: string): boolean => part.trim() !== "";

/** Queued messages as one draft, as the IDE puts them back in the field when one is edited or a run is stopped. */
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

/** The field after restoring `queued` into it: the restored text ahead of what was typed since. */
export const draftWith = (queued: string, current: string): string =>
	[queued, current].filter(nonBlank).join(PARAGRAPH);
