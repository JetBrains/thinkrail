const STOPWORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"any",
	"are",
	"as",
	"at",
	"be",
	"been",
	"being",
	"both",
	"but",
	"by",
	"can",
	"could",
	"did",
	"do",
	"does",
	"each",
	"for",
	"from",
	"had",
	"has",
	"have",
	"he",
	"her",
	"his",
	"how",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"me",
	"my",
	"no",
	"nor",
	"not",
	"of",
	"on",
	"onto",
	"or",
	"our",
	"she",
	"so",
	"such",
	"than",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"to",
	"too",
	"us",
	"very",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"who",
	"whom",
	"why",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

const CHUNK = /[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)*/gu;
const SEPARATOR = /[_-]/;
const CAMEL = /[\p{Ll}\p{N}]\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;
const CAMEL_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const ASCII_WORD = /^[a-z]+$/;
const MIN_TOKEN_LENGTH = 2;

export interface Token {
	readonly term: string;
	readonly surface: string;
	readonly start: number;
	readonly end: number;
	readonly joined: boolean;
}

function isConsonant(word: string, at: number): boolean {
	const char = word[at];
	if (char === "a" || char === "e" || char === "i" || char === "o" || char === "u") return false;
	if (char === "y") return at === 0 || !isConsonant(word, at - 1);
	return true;
}

function measure(stem: string): number {
	let count = 0;
	let at = 0;
	while (at < stem.length && isConsonant(stem, at)) at += 1;
	while (at < stem.length) {
		while (at < stem.length && !isConsonant(stem, at)) at += 1;
		if (at >= stem.length) break;
		while (at < stem.length && isConsonant(stem, at)) at += 1;
		count += 1;
	}
	return count;
}

function hasVowel(stem: string): boolean {
	for (let at = 0; at < stem.length; at += 1) if (!isConsonant(stem, at)) return true;
	return false;
}

function endsDoubleConsonant(word: string): boolean {
	const last = word.length - 1;
	return last > 0 && word[last] === word[last - 1] && isConsonant(word, last);
}

function endsCvc(word: string): boolean {
	const last = word.length - 1;
	if (last < 2) return false;
	const char = word[last] ?? "";
	return (
		isConsonant(word, last - 2) &&
		!isConsonant(word, last - 1) &&
		isConsonant(word, last) &&
		char !== "w" &&
		char !== "x" &&
		char !== "y"
	);
}

export function stem(word: string): string {
	if (word.length < 3 || !ASCII_WORD.test(word)) return word;
	let w = word;
	if (w.endsWith("sses") || w.endsWith("ies")) w = w.slice(0, -2);
	else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
		w = w.slice(0, -1);
	}
	let suffixed = false;
	if (w.endsWith("eed")) {
		if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
	} else if (w.endsWith("ed") && hasVowel(w.slice(0, -2))) {
		w = w.slice(0, -2);
		suffixed = true;
	} else if (w.endsWith("ing") && hasVowel(w.slice(0, -3))) {
		w = w.slice(0, -3);
		suffixed = true;
	}
	if (suffixed) {
		if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w = `${w}e`;
		else if (endsDoubleConsonant(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
		else if (measure(w) === 1 && endsCvc(w)) w = `${w}e`;
	}
	if (w.length > 2 && w.endsWith("y") && !"aeiouy".includes(w[w.length - 2] ?? "")) {
		w = `${w.slice(0, -1)}i`;
	}
	if (w.length >= 6 && w.endsWith("li") && "cdeghkmnrt".includes(w[w.length - 3] ?? "")) {
		w = w.slice(0, -2);
	}
	if (w.endsWith("e")) {
		const base = w.slice(0, -1);
		const m = measure(base);
		if (m > 1 || (m === 1 && !endsCvc(base))) w = base;
	}
	if (w.endsWith("ll") && measure(w) > 1) w = w.slice(0, -1);
	return w;
}

export function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	const push = (surface: string, start: number, end: number, joined: boolean) => {
		if (surface.length < MIN_TOKEN_LENGTH || STOPWORDS.has(surface)) return;
		tokens.push({ term: stem(surface), surface, start, end, joined });
	};
	for (const match of text.matchAll(CHUNK)) {
		const chunk = match[0];
		const at = match.index;
		const pieces: { text: string; start: number }[] = [];
		let offset = at;
		for (const part of chunk.split(SEPARATOR)) {
			if (CAMEL.test(part)) {
				let inner = offset;
				for (const piece of part.split(CAMEL_BOUNDARY)) {
					pieces.push({ text: piece, start: inner });
					inner += piece.length;
				}
			} else {
				pieces.push({ text: part, start: offset });
			}
			offset += part.length + 1;
		}
		if (pieces.length > 1) {
			push(pieces.map((piece) => piece.text.toLowerCase()).join(""), at, at + chunk.length, true);
		}
		for (const piece of pieces) {
			push(piece.text.toLowerCase(), piece.start, piece.start + piece.text.length, false);
		}
	}
	return tokens;
}

export function flatten(text: string): string {
	return text.toLowerCase().replace(NON_WORD, " ").trim();
}
