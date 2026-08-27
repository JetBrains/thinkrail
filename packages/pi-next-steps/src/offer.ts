import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { readOfferedItems } from "./normalize.ts";
import { type NextStepItem, TOOL_NAME } from "./schema.ts";

export interface CurrentOffer {
	toolCallId: string;
	items: NextStepItem[];
}

export function currentOffer(entries: readonly SessionEntry[]): CurrentOffer | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (!("role" in message) || message.role !== "toolResult") return null;
		if (message.toolName !== TOOL_NAME || message.isError) return null;
		const items = readOfferedItems(message.details);
		return items ? { toolCallId: message.toolCallId, items } : null;
	}
	return null;
}
