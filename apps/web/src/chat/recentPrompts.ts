import type { ChatTurn } from "./types";

/** The anchor text of a turn: the user prompt or the assistant's concatenated text blocks. */
export function turnAnchorText(turn: ChatTurn): string {
	if (turn.kind === "user") {
		const { content } = turn.message;
		return typeof content === "string"
			? content
			: content
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
	}
	if (turn.kind === "assistant") {
		return turn.message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	return "";
}

/**
 * The composer's recent-prompt history: every user prompt's text, newest first, de-duplicated. Pure so a
 * `useShallow` selector can compare element-wise and spare the shell a re-render while assistant text streams
 * (the user prompts are unchanged across deltas).
 */
export function deriveRecentPrompts(turns: ChatTurn[]): string[] {
	const texts = turns
		.filter((t) => t.kind === "user")
		.map((t) => turnAnchorText(t))
		.filter(Boolean);
	return [...new Set(texts.reverse())];
}
