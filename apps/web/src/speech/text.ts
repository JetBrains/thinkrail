/** Where a dictation writes: the field's text and selection when it started. */
export interface DictationAnchor {
	base: string;
	start: number;
	end: number;
}

export interface DictationText {
	text: string;
	caret: number;
}

const NO_SPACE_AFTER = /[\s([{"'`/@#-]$/;
const NO_SPACE_BEFORE = /^[\s.,;:!?)\]}"'`]/;

/** Joins recognized segments: each final is one utterance, the partial is the one in progress. */
export function spokenText(finals: readonly string[], partial: string): string {
	return [...finals, partial.trim()].filter((segment) => segment.length > 0).join(" ");
}

/**
 * The field's text with the dictation replacing the selection it started from, separated from its
 * neighbours by a space where a typist would put one. The caret sits right after the spoken text.
 */
export function dictationText(anchor: DictationAnchor, spoken: string): DictationText {
	const before = anchor.base.slice(0, anchor.start);
	const after = anchor.base.slice(anchor.end);
	if (spoken.length === 0) return { text: before + after, caret: before.length };
	const lead = before.length > 0 && !NO_SPACE_AFTER.test(before) ? " " : "";
	const trail = after.length > 0 && !NO_SPACE_BEFORE.test(after) ? " " : "";
	const inserted = `${lead}${spoken}${trail}`;
	return { text: before + inserted + after, caret: before.length + lead.length + spoken.length };
}
