const CARD_ID = /^([A-Z]{2,4})-([1-9]\d{0,8})$/;
const FALLBACK_PREFIX = "BD";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function words(name: string): string[] {
	const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
	return (ascii.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? []).map((word) => word.toUpperCase());
}

/** A project's card prefix candidates, best first: initials of a multi-word name, else a word's first letters. */
export function prefixCandidates(projectName: string): string[] {
	const parts = words(projectName);
	const letters = parts.join("");
	const base =
		parts.length >= 2
			? parts
					.slice(0, 4)
					.map((part) => part[0])
					.join("")
			: letters.slice(0, 3);
	if (base.length < 2) return [FALLBACK_PREFIX];
	const extended = base.length < 4 ? [...letters.slice(1)].map((letter) => `${base}${letter}`) : [];
	return [...new Set([base, ...extended])];
}

/** A 2–4 letter prefix no other board uses. */
export function allocatePrefix(projectName: string, taken: ReadonlySet<string>): string {
	const candidates = prefixCandidates(projectName);
	const free = candidates.find((candidate) => !taken.has(candidate));
	if (free) return free;
	const stem = (candidates[0] ?? FALLBACK_PREFIX).slice(0, 2);
	for (const second of ALPHABET) {
		for (const third of ALPHABET) {
			const candidate = `${stem}${second}${third}`;
			if (!taken.has(candidate)) return candidate;
		}
	}
	throw new Error("No free card prefix is left");
}

export function cardId(prefix: string, number: number): string {
	return `${prefix}-${number}`;
}

/** `{ prefix, number }` of a card id (case-insensitive), `null` for anything else. */
export function parseCardId(id: string): { prefix: string; number: number } | null {
	const match = CARD_ID.exec(id.trim().toUpperCase());
	if (!match) return null;
	return { prefix: match[1] ?? "", number: Number(match[2]) };
}
