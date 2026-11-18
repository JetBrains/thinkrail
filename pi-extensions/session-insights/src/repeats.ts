import { type Redactor, safeCut } from "./redact.ts";

/** A prompt sentence as the repeated-instruction rule compares it: hashed three-word shingles, no text. */
export interface PromptSentence {
	shingles: readonly number[];
	/** A redacted, one-line excerpt for the card that quotes it. */
	excerpt: string;
}

const PROMPT_CHARS = 4000;
const SENTENCES = 40;
const MAX_WORDS = 60;
const EXCERPT_CHARS = 200;
const SHINGLE = 3;
const BANDS = 12;
const ROWS = 2;
const BUCKET_MAX = 200;

function fnv(text: string): number {
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at++) {
		hash ^= text.charCodeAt(at);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function mix(value: number): number {
	let hash = value >>> 0;
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b);
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35);
	hash ^= hash >>> 16;
	return hash >>> 0;
}

/** Sentences of a prompt worth comparing: fenced code and tagged blocks dropped, `minWords`…60 words. */
export function promptSentences(
	prompt: string,
	redactor: Redactor,
	minWords: number,
): PromptSentence[] {
	const masked = redactor.around(prompt, 0, PROMPT_CHARS).text;
	const prose = masked
		.slice(0, safeCut(masked, PROMPT_CHARS))
		.replace(/```[\s\S]*?(```|$)/g, "\n")
		.replace(/<([A-Za-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, "\n");
	const out: PromptSentence[] = [];
	for (const raw of prose.split(/(?<=[.!?。])\s+|\n+/)) {
		const sentence = raw.trim();
		if (!sentence) continue;
		const words = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
		if (words.length < minWords || words.length > MAX_WORDS) continue;
		const shingles = new Set<number>();
		for (let at = 0; at + SHINGLE <= words.length; at++)
			shingles.add(fnv(words.slice(at, at + SHINGLE).join(" ")));
		out.push({
			shingles: [...shingles].sort((a, b) => a - b),
			excerpt: redactor.label(sentence, EXCERPT_CHARS),
		});
		if (out.length >= SENTENCES) break;
	}
	return out;
}

const PROMPT_WORDS = 256;

/** A prompt's words of three or more letters, lower case, hashed, sorted and unique (no text kept). */
export function promptWords(prompt: string): number[] {
	const set = new Set<number>();
	for (const word of prompt
		.slice(0, PROMPT_CHARS)
		.toLowerCase()
		.match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
		set.add(fnv(word));
		if (set.size >= PROMPT_WORDS) break;
	}
	return [...set].sort((a, b) => a - b);
}

/** Jaccard overlap of two sorted, unique hash lists. */
export function jaccard(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	let i = 0;
	let j = 0;
	let common = 0;
	while (i < a.length && j < b.length) {
		const left = a[i] ?? 0;
		const right = b[j] ?? 0;
		if (left === right) {
			common += 1;
			i += 1;
			j += 1;
		} else if (left < right) i += 1;
		else j += 1;
	}
	return common / (a.length + b.length - common);
}

function signature(shingles: readonly number[]): number[] {
	const out = new Array<number>(BANDS * ROWS).fill(0xffffffff);
	for (const shingle of shingles)
		for (let seed = 0; seed < out.length; seed++) {
			const value = mix(shingle ^ Math.imul(seed + 1, 0x9e3779b1));
			if (value < (out[seed] ?? 0xffffffff)) out[seed] = value;
		}
	return out;
}

/** A sentence of one session, in the order the caller lists them (that order breaks every tie). */
export interface SentenceItem {
	session: number;
	eventId: string;
	sentence: PromptSentence;
}

export interface SentenceCluster {
	/** Indices into the input, in input order; the first is the representative. */
	members: readonly number[];
	sessions: readonly number[];
}

/**
 * Near-verbatim sentences across sessions: identical shingle sets fold first, then candidates share a
 * MinHash band (12 bands of 2 rows over three-word shingles) and pairs at or above `similarity`
 * (Jaccard) join one cluster. Clusters spanning at least `minSessions` sessions, most sessions first.
 * Deterministic.
 */
export function clusterSentences(
	items: readonly SentenceItem[],
	similarity: number,
	minSessions: number,
): SentenceCluster[] {
	const uniqueOf = new Map<string, number>();
	const unique: { shingles: readonly number[]; members: number[]; sessions: Set<number> }[] = [];
	items.forEach((item, at) => {
		const key = item.sentence.shingles.join(",");
		let index = uniqueOf.get(key);
		if (index === undefined) {
			index = unique.length;
			uniqueOf.set(key, index);
			unique.push({ shingles: item.sentence.shingles, members: [], sessions: new Set() });
		}
		unique[index]?.members.push(at);
		unique[index]?.sessions.add(item.session);
	});
	const parent = unique.map((_, at) => at);
	const find = (at: number): number => {
		let root = at;
		while (parent[root] !== root) root = parent[root] ?? root;
		let walk = at;
		while (parent[walk] !== root) {
			const next = parent[walk] ?? root;
			parent[walk] = root;
			walk = next;
		}
		return root;
	};
	const join = (a: number, b: number) => {
		const left = find(a);
		const right = find(b);
		if (left === right) return;
		if (left < right) parent[right] = left;
		else parent[left] = right;
	};
	const signatures = unique.map((entry) => signature(entry.shingles));
	const checked = new Set<string>();
	for (let band = 0; band < BANDS; band++) {
		const buckets = new Map<string, number[]>();
		signatures.forEach((sig, at) => {
			const key = sig.slice(band * ROWS, band * ROWS + ROWS).join(":");
			const bucket = buckets.get(key);
			if (bucket) bucket.push(at);
			else buckets.set(key, [at]);
		});
		for (const bucket of buckets.values()) {
			if (bucket.length < 2 || bucket.length > BUCKET_MAX) continue;
			for (let i = 0; i < bucket.length; i++)
				for (let j = i + 1; j < bucket.length; j++) {
					const a = bucket[i] ?? 0;
					const b = bucket[j] ?? 0;
					const key = `${a}:${b}`;
					if (checked.has(key)) continue;
					checked.add(key);
					const left = unique[a];
					const right = unique[b];
					if (left && right && jaccard(left.shingles, right.shingles) >= similarity) join(a, b);
				}
		}
	}
	const groups = new Map<number, number[]>();
	unique.forEach((entry, at) => {
		const root = find(at);
		const group = groups.get(root);
		if (group) group.push(...entry.members);
		else groups.set(root, [...entry.members]);
	});
	const clusters: SentenceCluster[] = [];
	for (const group of groups.values()) {
		const members = group.sort((a, b) => a - b);
		const sessions = [...new Set(members.map((at) => items[at]?.session ?? -1))].sort(
			(a, b) => a - b,
		);
		if (sessions.length >= minSessions) clusters.push({ members, sessions });
	}
	return clusters.sort(
		(a, b) =>
			b.sessions.length - a.sessions.length ||
			b.members.length - a.members.length ||
			(a.members[0] ?? 0) - (b.members[0] ?? 0),
	);
}
