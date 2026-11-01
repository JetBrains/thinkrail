import type { TranscriptMessage } from "@thinkrail/contracts";

export interface TranscriptLine {
	role: "user" | "assistant" | "other";
	text: string;
}

export function transcriptLine(message: TranscriptMessage): TranscriptLine | null {
	const m = message as { role?: unknown; content?: unknown; summary?: unknown };
	let text = "";
	if (typeof m.content === "string") text = m.content;
	else if (Array.isArray(m.content)) {
		text = m.content
			.map((block) =>
				block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
					? (block as { text: string }).text
					: "",
			)
			.join("");
	} else if (typeof m.summary === "string") text = m.summary;
	text = text.trim();
	if (!text) return null;
	const role = m.role === "user" || m.role === "assistant" ? m.role : "other";
	return { role, text };
}
