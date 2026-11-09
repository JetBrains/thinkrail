export const MATCH_TIER = {
	exact: 0,
	prefix: 1,
	word: 2,
	substring: 3,
	fuzzy: 4,
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

export interface MatchTerm {
	readonly text: string;
	readonly literal: boolean;
}

const MAX_MATCH_TERM_LENGTH = 100;
const MAX_MATCH_TEXT_LENGTH = 1000;
const MIN_FUZZY_TERM_LENGTH = 3;

interface TermHit {
	tier: MatchTier;
	score: number;
	ranges: MatchRange[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{N}/u;

export function parseMatchTerms(query: string): MatchTerm[] {
	const terms: MatchTerm[] = [];
	const pattern = /"([^"]*)"?|(\S+)/g;
	for (const match of query.matchAll(pattern)) {
		const text = clusterCut((match[1] ?? match[2] ?? "").trim(), MAX_MATCH_TERM_LENGTH);
		if (text) terms.push({ text, literal: match[1] !== undefined });
	}
	return terms;
}

const DOTTED_CAPITAL_I = /\u0130/g;
const FINAL_SIGMA = /\u03c2/g;
const NON_ASCII = /[\u0080-\uffff]/;
const MARK = /\p{M}/u;
const LETTER = /\p{L}/u;
const STRIPPED_MARK = /[\u0300-\u036f]/;
const FOLD_MEMO_LIMIT = 4_096;
const continuationUnits = new Uint8Array(0x10000);
const stableUnits = new Uint8Array(0x10000);
const continuationPoints = new Map<number, boolean>();
const foldMemo = new Map<string, string>();

function lowerCase(text: string): string {
	let lower = text.toLowerCase();
	if (lower.length !== text.length) lower = text.replace(DOTTED_CAPITAL_I, "i").toLowerCase();
	return lower.includes("\u03c2") ? lower.replace(FINAL_SIGMA, "\u03c3") : lower;
}

function isContinuationPoint(point: number): boolean {
	if (point < 0x300) return false;
	if (point <= 0xffff) {
		let known = continuationUnits[point] ?? 0;
		if (known === 0) {
			const continues =
				(point >= 0x1160 && point <= 0x11ff) ||
				(point >= 0xd7b0 && point <= 0xd7ff) ||
				MARK.test(String.fromCharCode(point));
			known = continues ? 2 : 1;
			continuationUnits[point] = known;
		}
		return known === 2;
	}
	let known = continuationPoints.get(point);
	if (known === undefined) {
		known = MARK.test(String.fromCodePoint(point));
		continuationPoints.set(point, known);
	}
	return known;
}

function pointAt(text: string, index: number): number {
	return text.codePointAt(index) ?? 0;
}

function isContinuationAt(text: string, index: number): boolean {
	return index < text.length && isContinuationPoint(pointAt(text, index));
}

function stripMarks(decomposed: string): string {
	let kept = "";
	let afterLetter = false;
	for (const char of decomposed) {
		if (isContinuationPoint(char.codePointAt(0) ?? 0)) {
			if (!(afterLetter && STRIPPED_MARK.test(char))) kept += char;
			continue;
		}
		kept += char;
		afterLetter = LETTER.test(char);
	}
	return kept;
}

function foldCluster(cluster: string): string {
	let folded = foldMemo.get(cluster);
	if (folded === undefined) {
		folded = stripMarks(cluster.normalize("NFD")).normalize("NFC");
		if (folded === cluster) folded = cluster;
		if (foldMemo.size >= FOLD_MEMO_LIMIT) foldMemo.clear();
		foldMemo.set(cluster, folded);
	}
	return folded;
}

interface FoldedText {
	readonly text: string;
	readonly at: (index: number) => number;
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

function isEdge(text: string, index: number): boolean {
	if (index <= 0 || index >= text.length) return true;
	const unit = text.charCodeAt(index);
	return !(unit >= 0xdc00 && unit <= 0xdfff && isHighSurrogate(text.charCodeAt(index - 1)));
}

function isClusterStart(text: string, index: number): boolean {
	return index >= text.length || (isEdge(text, index) && !isContinuationAt(text, index));
}

function clusterEnd(text: string, index: number): number {
	let at = index;
	while (at < text.length && !isClusterStart(text, at)) at += 1;
	return at;
}

function nextCluster(text: string, index: number): number {
	return clusterEnd(text, index + (pointAt(text, index) > 0xffff ? 2 : 1));
}

function clusterCut(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(0, clusterEnd(text, limit));
}

function clustersOf(text: string): string[] {
	const clusters: string[] = [];
	for (let index = 0; index < text.length; ) {
		const end = nextCluster(text, index);
		clusters.push(text.slice(index, end));
		index = end;
	}
	return clusters;
}

function identityFold(text: string): FoldedText {
	return { text, at: (index) => index };
}

function foldText(raw: string): FoldedText {
	const cased = lowerCase(raw);
	if (!NON_ASCII.test(cased)) return identityFold(cased);
	const parts: string[] = [];
	const foldedStarts: number[] = [];
	const rawStarts: number[] = [];
	const flat: boolean[] = [];
	let copyFrom = 0;
	let length = 0;
	let index = 0;
	while (index < cased.length) {
		const start = index;
		const point = pointAt(cased, index);
		index += point > 0xffff ? 2 : 1;
		while (isContinuationAt(cased, index)) index += pointAt(cased, index) > 0xffff ? 2 : 1;
		const single = index - start === 1;
		if (point < 0x80 && single) continue;
		if (single && stableUnits[point] === 1) continue;
		const cluster = cased.slice(start, index);
		const folded = foldCluster(cluster);
		if (single) stableUnits[point] = folded === cluster ? 1 : 2;
		if (folded === cluster) continue;
		parts.push(cased.slice(copyFrom, start), folded);
		length += start - copyFrom;
		copyFrom = index;
		if (folded.length !== cluster.length) {
			foldedStarts.push(length, length + folded.length);
			rawStarts.push(start, index);
			flat.push(true, false);
		}
		length += folded.length;
	}
	if (parts.length === 0) return identityFold(cased);
	parts.push(cased.slice(copyFrom));
	const text = parts.join("");
	if (foldedStarts.length === 0) return identityFold(text);
	const at = (folded: number): number => {
		let low = 0;
		let high = foldedStarts.length - 1;
		let segment = -1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			if ((foldedStarts[middle] ?? 0) <= folded) {
				segment = middle;
				low = middle + 1;
			} else high = middle - 1;
		}
		if (segment === -1) return folded;
		const rawStart = rawStarts[segment] ?? 0;
		return flat[segment] ? rawStart : rawStart + (folded - (foldedStarts[segment] ?? 0));
	};
	return { text, at };
}

export function foldMatchText(text: string): string {
	return foldText(text).text;
}

function baseBefore(text: string, index: number): string {
	let before = index - 1;
	while (before > 0 && MARK.test(text[before] ?? "")) before -= 1;
	return text[before] ?? "";
}

function isWordStart(text: string, index: number): boolean {
	if (index === 0) return true;
	const previous = baseBefore(text, index);
	const current = text[index] ?? "";
	if (!LETTER_OR_DIGIT.test(previous)) return LETTER_OR_DIGIT.test(current);
	if (UPPER.test(current) && LOWER.test(previous)) return true;
	return DIGIT.test(current) && !DIGIT.test(previous);
}

function occurrence(lower: string, term: string, from = 0): number {
	for (let index = lower.indexOf(term, from); index >= 0; index = lower.indexOf(term, index + 1)) {
		if (isClusterStart(lower, index) && isEdge(lower, index + term.length)) return index;
	}
	return -1;
}

function clusterHead(lower: string, index: number, end: number, wanted: string): boolean {
	return index + wanted.length <= end && lower.startsWith(wanted, index);
}

function matchAcronym(
	clusters: readonly string[],
	text: string,
	folded: FoldedText,
): MatchRange[] | null {
	if (clusters.length < 2) return null;
	const lower = folded.text;
	const ranges: MatchRange[] = [];
	let next = 0;
	for (let index = 0; index < lower.length && next < clusters.length; ) {
		const end = nextCluster(lower, index);
		if (
			clusterHead(lower, index, end, clusters[next] ?? "") &&
			isWordStart(text, folded.at(index))
		) {
			ranges.push([folded.at(index), folded.at(end)]);
			next += 1;
		}
		index = end;
	}
	return next === clusters.length ? ranges : null;
}

const MAX_FUZZY_STARTS = 32;

function subsequenceFrom(
	clusters: readonly string[],
	lower: string,
	start: number,
): { starts: number[]; ends: number[] } | null {
	const starts: number[] = [];
	const ends: number[] = [];
	let next = 0;
	for (let index = start; index < lower.length && next < clusters.length; ) {
		const end = nextCluster(lower, index);
		if (clusterHead(lower, index, end, clusters[next] ?? "")) {
			starts.push(index);
			ends.push(end);
			next += 1;
		}
		index = end;
	}
	return next === clusters.length ? { starts, ends } : null;
}

function clusterOccurrence(lower: string, cluster: string, from: number): number {
	for (
		let index = lower.indexOf(cluster, from);
		index >= 0;
		index = lower.indexOf(cluster, index + 1)
	) {
		if (isClusterStart(lower, index)) return index;
	}
	return -1;
}

function matchSubsequence(
	clusters: readonly string[],
	termLength: number,
	text: string,
	folded: FoldedText,
): TermHit | null {
	if (clusters.length < MIN_FUZZY_TERM_LENGTH) return null;
	const lower = folded.text;
	const first = clusters[0] ?? "";
	let best: { starts: number[]; ends: number[] } | null = null;
	let span = Number.POSITIVE_INFINITY;
	let start = clusterOccurrence(lower, first, 0);
	for (let attempt = 0; start >= 0 && attempt < MAX_FUZZY_STARTS; attempt++) {
		const candidate = subsequenceFrom(clusters, lower, start);
		if (!candidate) break;
		const candidateSpan = (candidate.ends[candidate.ends.length - 1] ?? start) - start;
		if (candidateSpan < span) {
			best = candidate;
			span = candidateSpan;
		}
		start = clusterOccurrence(lower, first, start + 1);
	}
	if (!best || span > termLength * 3) return null;
	const wordStarts = best.starts.filter((at) => isWordStart(text, folded.at(at))).length;
	const runs: [number, number][] = [];
	best.starts.forEach((from, index) => {
		const to = best?.ends[index] ?? from;
		const previous = runs[runs.length - 1];
		if (previous && previous[1] === from) previous[1] = to;
		else runs.push([from, to]);
	});
	return {
		tier: MATCH_TIER.fuzzy,
		score: 0.7 * (termLength / span) + 0.3 * (wordStarts / clusters.length),
		ranges: runs.map(([from, to]) => [folded.at(from), folded.at(to)]),
	};
}

function matchText(matchTerm: MatchTerm, rawText: string): TermHit | null {
	const term = foldText(matchTerm.text).text;
	const text = clusterCut(rawText, MAX_MATCH_TEXT_LENGTH);
	const folded = foldText(text);
	const lower = folded.text;
	if (!term || !lower) return null;
	const span = (from: number, to: number): MatchRange => [
		folded.at(from),
		folded.at(clusterEnd(lower, to)),
	];
	const lengthRatio = Math.min(1, term.length / lower.length);
	if (lower === term) return { tier: MATCH_TIER.exact, score: 1, ranges: [[0, text.length]] };
	if (lower.startsWith(term) && isEdge(lower, term.length)) {
		return { tier: MATCH_TIER.prefix, score: lengthRatio, ranges: [span(0, term.length)] };
	}
	const firstSubstring = occurrence(lower, term);
	for (let index = firstSubstring; index >= 0; index = occurrence(lower, term, index + 1)) {
		if (!isWordStart(text, folded.at(index))) continue;
		return {
			tier: MATCH_TIER.word,
			score: 0.6 * lengthRatio + 0.4 * (1 - index / lower.length),
			ranges: [span(index, index + term.length)],
		};
	}
	const clusters = clustersOf(term);
	if (!matchTerm.literal) {
		const acronym = matchAcronym(clusters, text, folded);
		if (acronym) {
			return { tier: MATCH_TIER.word, score: 0.5 * lengthRatio, ranges: acronym };
		}
	}
	if (firstSubstring >= 0) {
		return {
			tier: MATCH_TIER.substring,
			score: 0.5 * lengthRatio + 0.5 * (1 - firstSubstring / lower.length),
			ranges: [span(firstSubstring, firstSubstring + term.length)],
		};
	}
	return matchTerm.literal ? null : matchSubsequence(clusters, term.length, text, folded);
}

function shifted(hit: TermHit, offset: number): TermHit {
	if (offset === 0) return hit;
	return { ...hit, ranges: hit.ranges.map(([start, end]) => [start + offset, end + offset]) };
}

function capSecondary(hit: TermHit | null): TermHit | null {
	if (!hit || hit.tier >= MATCH_TIER.substring) return hit;
	return { ...hit, tier: MATCH_TIER.substring };
}

function matchField(term: MatchTerm, field: MatchField): TermHit | null {
	if (field.path && !term.text.includes("/")) {
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
	terms: readonly MatchTerm[],
	fields: readonly MatchField[],
): MatchResult | null {
	if (terms.length === 0) return { tier: MATCH_TIER.exact, score: 0, fields: [] };
	let tier: MatchTier = MATCH_TIER.exact;
	let score = 0;
	const rangesByKey = new Map<string, MatchRange[]>();
	for (const term of terms) {
		let best: { hit: TermHit; key: string; secondary: boolean } | null = null;
		for (const field of fields) {
			const hit = matchField(term, field);
			if (!hit) continue;
			const secondary = field.secondary === true;
			if (
				!best ||
				hit.tier < best.hit.tier ||
				(hit.tier === best.hit.tier &&
					(secondary === best.secondary ? hit.score > best.hit.score : best.secondary))
			) {
				best = { hit, key: field.key, secondary };
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

export interface PreparedContent {
	readonly raw: string;
	readonly fold: FoldedText;
}

export interface ContentMatch {
	readonly first: number;
	readonly ranges: readonly MatchRange[];
}

export function prepareContent(raw: string): PreparedContent {
	return { raw, fold: foldText(raw) };
}

function termRange(term: string, content: PreparedContent): MatchRange | null {
	const { fold } = content;
	const index = term ? occurrence(fold.text, term) : -1;
	return index < 0 ? null : [fold.at(index), fold.at(clusterEnd(fold.text, index + term.length))];
}

export function matchContent(
	foldedTerms: readonly string[],
	content: PreparedContent,
): ContentMatch | null {
	const found: MatchRange[] = [];
	for (const term of foldedTerms) {
		const range = termRange(term, content);
		if (!range) return null;
		found.push(range);
	}
	const ranges = mergeRanges(found);
	const first = ranges[0];
	return first ? { first: first[0], ranges } : null;
}

export function contentRanges(
	foldedTerms: readonly string[],
	content: PreparedContent,
): MatchRange[] {
	const found: MatchRange[] = [];
	for (const term of foldedTerms) {
		const range = termRange(term, content);
		if (range) found.push(range);
	}
	return mergeRanges(found);
}
