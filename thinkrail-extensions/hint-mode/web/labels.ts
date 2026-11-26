export const HINT_ALPHABET = "asdfjklghqwertyuiop";

export function hintLabels(count: number, alphabet: string = HINT_ALPHABET): string[] {
	if (count <= 0) return [];
	const labels = [""];
	let expanded = 0;
	while (labels.length - expanded < count || labels.length === 1) {
		const prefix = labels[expanded++] ?? "";
		for (const letter of alphabet) labels.push(prefix + letter);
	}
	return labels.slice(expanded, expanded + count);
}

export function letterOfCode(code: string, alphabet: string = HINT_ALPHABET): string | null {
	const match = /^Key([A-Z])$/.exec(code);
	const letter = match?.[1]?.toLowerCase();
	return letter !== undefined && alphabet.includes(letter) ? letter : null;
}
