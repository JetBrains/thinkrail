export const MATCH_TIER = {
	exact: 0,
	prefix: 1,
	word: 2,
	substring: 3,
	fuzzy: 4,
	/** A body/transcript match: never a field the row is titled by, so always below every field tier. */
	content: 5,
} as const;

export type MatchTier = (typeof MATCH_TIER)[keyof typeof MATCH_TIER];

export interface MatchField {
	readonly key: string;
	readonly text: string;
	readonly secondary?: boolean;
	readonly path?: boolean;
}

export type MatchRange = readonly [start: number, end: number];

export interface FieldMatch {
	readonly key: string;
	readonly ranges: readonly MatchRange[];
}

export interface MatchResult {
	readonly tier: MatchTier;
	readonly score: number;
	readonly fields: readonly FieldMatch[];
}

const MAX_MATCH_TERM_LENGTH = 100;
const MAX_MATCH_TEXT_LENGTH = 1000;
const MIN_FUZZY_TERM_LENGTH = 3;

interface TermHit {
	tier: MatchTier;
	score: number;
	ranges: MatchRange[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{N}/u;

export function parseMatchTerms(query: string): string[] {
	const terms: string[] = [];
	const pattern = /"([^"]*)"|(\S+)/g;
	for (const match of query.matchAll(pattern)) {
		const term = (match[1] ?? match[2] ?? "").trim().slice(0, MAX_MATCH_TERM_LENGTH);
		if (term) terms.push(term);
	}
	return terms;
}

function isWordStart(text: string, index: number): boolean {
	if (index === 0) return true;
	const previous = text[index - 1] ?? "";
	const current = text[index] ?? "";
	if (!LETTER_OR_DIGIT.test(previous)) return LETTER_OR_DIGIT.test(current);
	if (UPPER.test(current) && LOWER.test(previous)) return true;
	return DIGIT.test(current) && !DIGIT.test(previous);
}

function matchAcronym(term: string, text: string, lower: string): MatchRange[] | null {
	if (term.length < 2) return null;
	const ranges: MatchRange[] = [];
	let next = 0;
	for (let index = 0; index < lower.length && next < term.length; index++) {
		if (!isWordStart(text, index)) continue;
		if (lower[index] !== term[next]) continue;
		ranges.push([index, index + 1]);
		next += 1;
	}
	return next === term.length ? ranges : null;
}

const MAX_FUZZY_STARTS = 32;

function subsequenceFrom(term: string, lower: string, start: number): number[] | null {
	const positions: number[] = [];
	let next = 0;
	for (let index = start; index < lower.length && next < term.length; index++) {
		if (lower[index] !== term[next]) continue;
		positions.push(index);
		next += 1;
	}
	return next === term.length ? positions : null;
}

function matchSubsequence(term: string, text: string, lower: string): TermHit | null {
	if (term.length < MIN_FUZZY_TERM_LENGTH) return null;
	let positions: number[] | null = null;
	let span = Number.POSITIVE_INFINITY;
	let start = lower.indexOf(term[0] ?? "");
	for (let attempt = 0; start >= 0 && attempt < MAX_FUZZY_STARTS; attempt++) {
		const candidate = subsequenceFrom(term, lower, start);
		if (!candidate) break;
		const candidateSpan = (candidate[candidate.length - 1] ?? start) - start + 1;
		if (candidateSpan < span) {
			positions = candidate;
			span = candidateSpan;
		}
		start = lower.indexOf(term[0] ?? "", start + 1);
	}
	if (!positions || span > term.length * 3) return null;
	const wordStarts = positions.filter((position) => isWordStart(text, position)).length;
	const ranges: MatchRange[] = [];
	for (const position of positions) {
		const previous = ranges[ranges.length - 1];
		if (previous && previous[1] === position)
			ranges[ranges.length - 1] = [previous[0], position + 1];
		else ranges.push([position, position + 1]);
	}
	return {
		tier: MATCH_TIER.fuzzy,
		score: 0.7 * (term.length / span) + 0.3 * (wordStarts / term.length),
		ranges,
	};
}

function matchText(rawTerm: string, rawText: string): TermHit | null {
	const term = rawTerm.toLowerCase();
	const text = rawText.slice(0, MAX_MATCH_TEXT_LENGTH);
	const lower = text.toLowerCase();
	if (!term || !lower) return null;
	const lengthRatio = Math.min(1, term.length / lower.length);
	if (lower === term) return { tier: MATCH_TIER.exact, score: 1, ranges: [[0, text.length]] };
	if (lower.startsWith(term)) {
		return { tier: MATCH_TIER.prefix, score: lengthRatio, ranges: [[0, term.length]] };
	}
	const firstSubstring = lower.indexOf(term);
	for (let index = firstSubstring; index >= 0; index = lower.indexOf(term, index + 1)) {
		if (!isWordStart(text, index)) continue;
		return {
			tier: MATCH_TIER.word,
			score: 0.6 * lengthRatio + 0.4 * (1 - index / lower.length),
			ranges: [[index, index + term.length]],
		};
	}
	if (!term.includes(" ")) {
		const acronym = matchAcronym(term, text, lower);
		if (acronym) {
			return { tier: MATCH_TIER.word, score: 0.5 * lengthRatio, ranges: acronym };
		}
	}
	if (firstSubstring >= 0) {
		return {
			tier: MATCH_TIER.substring,
			score: 0.5 * lengthRatio + 0.5 * (1 - firstSubstring / lower.length),
			ranges: [[firstSubstring, firstSubstring + term.length]],
		};
	}
	return term.includes(" ") ? null : matchSubsequence(term, text, lower);
}

function shifted(hit: TermHit, offset: number): TermHit {
	if (offset === 0) return hit;
	return { ...hit, ranges: hit.ranges.map(([start, end]) => [start + offset, end + offset]) };
}

function capSecondary(hit: TermHit | null): TermHit | null {
	if (!hit || hit.tier >= MATCH_TIER.substring) return hit;
	return { ...hit, tier: MATCH_TIER.substring };
}

function matchField(term: string, field: MatchField): TermHit | null {
	if (field.path && !term.includes("/")) {
		const slash = field.text.lastIndexOf("/");
		const base = matchText(term, field.text.slice(slash + 1));
		if (base) {
			const hit = shifted(base, slash + 1);
			return field.secondary ? capSecondary(hit) : hit;
		}
		return capSecondary(matchText(term, field.text));
	}
	const hit = matchText(term, field.text);
	return field.secondary ? capSecondary(hit) : hit;
}

function mergeRanges(ranges: readonly MatchRange[]): MatchRange[] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [];
	for (const [start, end] of sorted) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

export function matchFields(
	terms: readonly string[],
	fields: readonly MatchField[],
): MatchResult | null {
	if (terms.length === 0) return { tier: MATCH_TIER.exact, score: 0, fields: [] };
	let tier: MatchTier = MATCH_TIER.exact;
	let score = 0;
	const rangesByKey = new Map<string, MatchRange[]>();
	for (const term of terms) {
		let best: { hit: TermHit; key: string } | null = null;
		for (const field of fields) {
			const hit = matchField(term, field);
			if (!hit) continue;
			if (
				!best ||
				hit.tier < best.hit.tier ||
				(hit.tier === best.hit.tier && hit.score > best.hit.score)
			) {
				best = { hit, key: field.key };
			}
		}
		if (!best) return null;
		tier = Math.max(tier, best.hit.tier) as MatchTier;
		score += best.hit.score;
		const existing = rangesByKey.get(best.key) ?? [];
		existing.push(...best.hit.ranges);
		rangesByKey.set(best.key, existing);
	}
	return {
		tier,
		score: score / terms.length,
		fields: [...rangesByKey].map(([key, ranges]) => ({ key, ranges: mergeRanges(ranges) })),
	};
}

export function compareMatches(a: MatchResult, b: MatchResult): number {
	return a.tier - b.tier || b.score - a.score;
}
