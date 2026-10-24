import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

const NOTE_COPY: Record<string, MessageKey> = {
	default: "auth.login.optionRecommended",
	headless: "auth.login.optionHeadless",
};

export function loginSelectMessage(message: string): string {
	return message.trim().replace(/:$/, "");
}

export function loginOptionParts(
	label: string,
	t: Translator,
): {
	title: string;
	detail?: string;
	recommended: boolean;
} {
	const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(label.trim());
	if (!match?.[1] || !match[2]) return { title: label.trim(), recommended: false };
	const note = match[2].trim();
	const known = NOTE_COPY[note.toLowerCase()];
	return {
		title: match[1],
		detail: known ? t(known) : note.charAt(0).toUpperCase() + note.slice(1),
		recommended: note.toLowerCase() === "default",
	};
}

export function loginPromptMessage(message: string): string {
	return message
		.trim()
		.replace(/\s*\(blank for ([^()]+)\)$/i, ". Leave empty for $1.")
		.replace(/press Enter( to continue)?/gi, "choose Continue");
}
