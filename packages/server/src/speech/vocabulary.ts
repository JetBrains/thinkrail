export const MAX_PHRASES = 300;
export const PHRASE_BOOST = 3;

const MIN_LENGTH = 3;
const MAX_LENGTH = 48;

export interface VocabularySource {
	commands: string[];
	paths: string[];
}

function usable(phrase: string): boolean {
	return (
		phrase.length >= MIN_LENGTH &&
		phrase.length <= MAX_LENGTH &&
		/[A-Za-z]/.test(phrase) &&
		!/\s/.test(phrase)
	);
}

function identifierLike(word: string): boolean {
	return /[a-z][A-Z]|[A-Z]{2}[a-z]|[_-]|\d/.test(word);
}

export function speechPhrases(source: VocabularySource): string[] {
	const phrases = new Set<string>();
	const add = (phrase: string) => {
		if (phrases.size < MAX_PHRASES && usable(phrase)) phrases.add(phrase);
	};
	for (const command of source.commands) add(command.replace(/^skill:/, ""));
	const identifiers: string[] = [];
	const plain: string[] = [];
	const folders: string[] = [];
	for (const path of source.paths) {
		const segments = path.split("/").filter(Boolean);
		const base = segments.at(-1) ?? "";
		const dot = base.indexOf(".", 1);
		const stem = dot > 0 ? base.slice(0, dot) : base;
		(identifierLike(stem) ? identifiers : plain).push(base, stem);
		folders.push(...segments.slice(0, -1));
	}
	for (const phrase of [...identifiers, ...plain, ...folders]) {
		if (phrases.size >= MAX_PHRASES) break;
		add(phrase);
	}
	return [...phrases];
}
