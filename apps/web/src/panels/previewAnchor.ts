// Map a rendered-markdown selection back to SOURCE lines (see panels/SPEC.md). Rendered text is not
// the source text (emphasis/link/list markers are gone), so this is a best-effort phrase search over
// marker-stripped source lines: the selection's head phrase finds the start line, its tail phrase the
// end line. A failed mapping returns null — the caller degrades to a whole-file comment rather than
// pinning wrong lines. Pure (unit-tested).

import type { LineSelection } from "./reviewGutter";

/** Strip the markdown markers that rendering removes + collapse whitespace, for tolerant matching. */
export function normalizeFragment(text: string): string {
	return text
		.replace(/[*_`~#>[\]()|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/** How many leading/trailing words form the anchor phrases (shrinks when a phrase spans lines). */
const PHRASE_WORDS = 6;

/** The first line at/after `from` containing the phrase — tried at decreasing phrase length, since a
 * selection's edge words can straddle a source-line boundary (a list item into the next block). */
function findByPhrase(
	lines: string[],
	words: string[],
	edge: "head" | "tail",
	from: number,
): number {
	// Never fall back to a lone word of a LONGER selection — single common words match everywhere and
	// would pin wrong lines; a genuine one-word selection (a double-click) still searches by its word.
	const kMin = Math.min(words.length, 2);
	for (let k = Math.min(PHRASE_WORDS, words.length); k >= kMin; k--) {
		const phrase = edge === "head" ? words.slice(0, k).join(" ") : words.slice(-k).join(" ");
		for (let i = from; i < lines.length; i++) {
			const line = lines[i];
			if (line?.includes(phrase)) return i;
		}
	}
	return -1;
}

/**
 * The source line range a rendered-selection most plausibly came from, or `null` when its head phrase
 * appears nowhere in the (normalized) source. The head phrase pins the start line; the tail phrase, if
 * found at/after it, extends the range — so a selection spanning paragraphs maps to the whole span.
 */
export function mapPreviewSelection(source: string, selected: string): LineSelection | null {
	const fragment = normalizeFragment(selected);
	if (!fragment) return null;
	const words = fragment.split(" ");
	const lines = source.split("\n").map(normalizeFragment);
	const start = findByPhrase(lines, words, "head", 0);
	if (start < 0) return null;
	const end = findByPhrase(lines, words, "tail", start);
	return { startLine: start + 1, endLine: Math.max(start, end) + 1 };
}
