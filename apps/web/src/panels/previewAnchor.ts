import type { LineSelection } from "./reviewGutter";

export function normalizeFragment(text: string): string {
	return text
		.replace(/[*_`~#>[\]()|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

const PHRASE_WORDS = 6;

function findByPhrase(
	lines: string[],
	words: string[],
	edge: "head" | "tail",
	from: number,
): number {
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
