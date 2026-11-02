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

export function spokenText(finals: readonly string[], partial: string): string {
	return [...finals, partial.trim()].filter((segment) => segment.length > 0).join(" ");
}

export function dictationText(anchor: DictationAnchor, spoken: string): DictationText {
	const before = anchor.base.slice(0, anchor.start);
	const after = anchor.base.slice(anchor.end);
	if (spoken.length === 0) return { text: before + after, caret: before.length };
	const lead = before.length > 0 && !NO_SPACE_AFTER.test(before) ? " " : "";
	const trail = after.length > 0 && !NO_SPACE_BEFORE.test(after) ? " " : "";
	const inserted = `${lead}${spoken}${trail}`;
	return { text: before + inserted + after, caret: before.length + lead.length + spoken.length };
}
