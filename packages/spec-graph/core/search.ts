import { FIELDS, type Frontmatter, scalar } from "./parse.ts";
import { matchesFilters, type SpecContentEntry, type SpecFilters } from "./query.ts";
import { cleanInline, type SpecSection, splitSections } from "./sections.ts";
import { flatten, stem, tokenize } from "./tokenize.ts";

export const DEFAULT_SPEC_SEARCH_LIMIT = 8;

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const HEADING_WEIGHT = 2;
const BODY_WEIGHT = 1;
const PHRASE_BOOST = 2;
const RRF_K = 60;
const PREFIX_MIN_LENGTH = 3;
const PREFIX_EXPANSIONS = 32;
const PREFIX_WEIGHT = 0.7;
const PARTIAL_SUFFIX_TAILS = [
	{ typed: "i", rest: "ng" },
	{ typed: "in", rest: "g" },
] as const;
const SNIPPET_CHARS = 160;
const SNIPPET_LEAD = 48;
const SNIPPET_WORD_SLACK = 16;
const TASK_SPEC = "task-spec";
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_MARKER = /^\s*>\s?/;

export type TextRange = [start: number, end: number];

interface Vocabulary {
	readonly ids: Map<string, number>;
	readonly terms: string[];
}

interface Postings {
	readonly ids: Uint32Array;
	readonly counts: Uint16Array;
}

interface IndexedSection extends SpecSection {
	readonly headingTerms: Postings;
	readonly bodyTerms: Postings;
	readonly headingLength: number;
	readonly bodyLength: number;
	readonly flat: string;
}

interface IndexedFile {
	readonly path: string;
	readonly content: string;
	readonly frontmatter: Frontmatter;
	readonly id: string;
	readonly title: string;
	readonly type: string;
	readonly titleTerms: Postings;
	readonly titleLength: number;
	readonly sections: readonly IndexedSection[];
}

export interface SectionIndex {
	readonly vocabulary: Vocabulary;
	readonly files: ReadonlyMap<string, IndexedFile>;
	readonly sectionCount: number;
	readonly df: Uint32Array;
	readonly sorted: Uint32Array;
	readonly averages: { readonly title: number; readonly heading: number; readonly body: number };
}

export interface SpecSearchOptions extends SpecFilters {
	limit?: number;
}

export interface SpecSectionHit {
	readonly path: string;
	readonly id: string;
	readonly title: string;
	readonly type: string;
	readonly heading: string;
	readonly line: number;
	readonly endLine: number;
	readonly snippet: string;
	readonly snippetLine: number;
	readonly ranges: {
		readonly title: TextRange[];
		readonly heading: TextRange[];
		readonly snippet: TextRange[];
	};
	readonly score: number;
	readonly matched: number;
	readonly terms: number;
}

export interface SpecSearchResult {
	readonly hits: SpecSectionHit[];
	readonly total: number;
}

const MAX_COUNT = 0xffff;

function termIdOf(vocabulary: Vocabulary, term: string): number {
	let id = vocabulary.ids.get(term);
	if (id === undefined) {
		id = vocabulary.terms.length;
		vocabulary.terms.push(term);
		vocabulary.ids.set(term, id);
	}
	return id;
}

function postingsOf(counts: ReadonlyMap<number, number>): Postings {
	const ids = Uint32Array.from(counts.keys()).sort();
	return {
		ids,
		counts: Uint16Array.from(ids, (id) => Math.min(MAX_COUNT, counts.get(id) ?? 0)),
	};
}

function countOf(postings: Postings, id: number): number {
	let low = 0;
	let high = postings.ids.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const at = postings.ids[mid] ?? 0;
		if (at === id) return postings.counts[mid] ?? 0;
		if (at < id) low = mid + 1;
		else high = mid - 1;
	}
	return 0;
}

function indexFile(vocabulary: Vocabulary, entry: SpecContentEntry): IndexedFile {
	const id = scalar(entry.frontmatter, FIELDS.id) ?? "";
	const title = scalar(entry.frontmatter, FIELDS.title) ?? id;
	const field = (text: string) => {
		const counts = new Map<number, number>();
		const tokens = tokenize(text);
		for (const token of tokens) {
			const term = termIdOf(vocabulary, token.term);
			counts.set(term, (counts.get(term) ?? 0) + 1);
		}
		return { postings: postingsOf(counts), length: tokens.length };
	};
	const titleField = field(`${title} ${id}`);
	const sections: IndexedSection[] = [];
	for (const section of splitSections(entry.content)) {
		const heading = section.headings.join(" ");
		const body = section.body.join("\n");
		const headingField = field(heading);
		const bodyField = field(body);
		if (headingField.length + bodyField.length === 0) continue;
		sections.push({
			...section,
			headingTerms: headingField.postings,
			bodyTerms: bodyField.postings,
			headingLength: headingField.length,
			bodyLength: bodyField.length,
			flat: ` ${flatten(`${heading} ${body}`)}`,
		});
	}
	return {
		path: entry.path,
		content: entry.content,
		frontmatter: entry.frontmatter,
		id,
		title,
		type: scalar(entry.frontmatter, FIELDS.type) ?? "",
		titleTerms: titleField.postings,
		titleLength: titleField.length,
		sections,
	};
}

function corpusOf(vocabulary: Vocabulary, files: ReadonlyMap<string, IndexedFile>): SectionIndex {
	const df = new Uint32Array(vocabulary.terms.length);
	let sectionCount = 0;
	let title = 0;
	let heading = 0;
	let body = 0;
	for (const file of files.values()) {
		for (const section of file.sections) {
			sectionCount += 1;
			title += file.titleLength;
			heading += section.headingLength;
			body += section.bodyLength;
			for (const term of file.titleTerms.ids) df[term] = (df[term] ?? 0) + 1;
			for (const term of section.headingTerms.ids) {
				if (countOf(file.titleTerms, term) === 0) df[term] = (df[term] ?? 0) + 1;
			}
			for (const term of section.bodyTerms.ids) {
				if (countOf(file.titleTerms, term) === 0 && countOf(section.headingTerms, term) === 0) {
					df[term] = (df[term] ?? 0) + 1;
				}
			}
		}
	}
	const sorted: number[] = [];
	df.forEach((count, term) => {
		if (count > 0) sorted.push(term);
	});
	sorted.sort((a, b) => compareText(vocabulary.terms[a] ?? "", vocabulary.terms[b] ?? ""));
	const mean = (total: number) => (sectionCount > 0 && total > 0 ? total / sectionCount : 1);
	return {
		vocabulary,
		files,
		sectionCount,
		df,
		sorted: Uint32Array.from(sorted),
		averages: { title: mean(title), heading: mean(heading), body: mean(body) },
	};
}

export function indexSections(
	entries: readonly SpecContentEntry[],
	previous?: SectionIndex,
): SectionIndex {
	const vocabulary: Vocabulary = previous?.vocabulary ?? { ids: new Map(), terms: [] };
	const files = new Map<string, IndexedFile>();
	let changed = previous === undefined || previous.files.size !== entries.length;
	for (const entry of entries) {
		const prior = previous?.files.get(entry.path);
		if (prior !== undefined && prior.content === entry.content) {
			files.set(entry.path, prior);
		} else {
			files.set(entry.path, indexFile(vocabulary, entry));
			changed = true;
		}
	}
	return !changed && previous !== undefined ? previous : corpusOf(vocabulary, files);
}

interface QueryOption {
	readonly term: number;
	readonly idf: number;
	readonly weight: number;
}

interface QueryTerm {
	readonly joined: boolean;
	readonly weight: number;
	readonly options: readonly QueryOption[];
}

interface ParsedQuery {
	readonly terms: readonly QueryTerm[];
	readonly words: number;
	readonly weight: number;
	readonly phrase: string | null;
	readonly matchTerms: ReadonlySet<string>;
}

function idfOf(index: SectionIndex, df: number): number {
	return Math.log(1 + (index.sectionCount - df + 0.5) / (df + 0.5));
}

function dfOf(index: SectionIndex, term: number): number {
	return index.df[term] ?? 0;
}

function wordOf(index: SectionIndex, term: number): string {
	return index.vocabulary.terms[term] ?? "";
}

function known(index: SectionIndex, term: string): number | undefined {
	const id = index.vocabulary.ids.get(term);
	return id !== undefined && dfOf(index, id) > 0 ? id : undefined;
}

function expand(index: SectionIndex, surface: string): QueryOption[] {
	const { sorted } = index;
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (wordOf(index, sorted[mid] ?? 0) < surface) low = mid + 1;
		else high = mid;
	}
	const found = new Set<number>();
	for (let at = low; at < sorted.length; at += 1) {
		const term = sorted[at] ?? 0;
		if (!wordOf(index, term).startsWith(surface)) break;
		found.add(term);
	}
	for (const tail of PARTIAL_SUFFIX_TAILS) {
		if (!surface.endsWith(tail.typed)) continue;
		const term = known(index, stem(`${surface}${tail.rest}`));
		if (term !== undefined) found.add(term);
	}
	return [...found]
		.sort(
			(a, b) =>
				wordOf(index, a).length - wordOf(index, b).length ||
				dfOf(index, b) - dfOf(index, a) ||
				compareText(wordOf(index, a), wordOf(index, b)),
		)
		.slice(0, PREFIX_EXPANSIONS)
		.map((term) => ({ term, idf: idfOf(index, dfOf(index, term)), weight: PREFIX_WEIGHT }));
}

function parseQuery(index: SectionIndex, text: string): ParsedQuery {
	const terms: QueryTerm[] = [];
	const seen = new Set<string>();
	for (const token of tokenize(text)) {
		if (seen.has(token.term)) continue;
		seen.add(token.term);
		const id = known(index, token.term);
		const options =
			id !== undefined
				? [{ term: id, idf: idfOf(index, dfOf(index, id)), weight: 1 }]
				: token.surface.length >= PREFIX_MIN_LENGTH
					? expand(index, token.surface)
					: [];
		const weight = options.reduce((best, option) => Math.max(best, option.idf), 0);
		terms.push({ joined: token.joined, weight: weight || idfOf(index, 0), options });
	}
	const words = terms.filter((term) => !term.joined);
	const phrase = flatten(text);
	return {
		terms,
		words: words.length,
		weight: words.reduce((sum, term) => sum + term.weight, 0),
		phrase: phrase.length >= PREFIX_MIN_LENGTH ? ` ${phrase}` : null,
		matchTerms: new Set(
			terms.flatMap((term) => term.options.map((option) => wordOf(index, option.term))),
		),
	};
}

interface Scored {
	readonly file: IndexedFile;
	readonly section: IndexedSection;
	readonly score: number;
	readonly matched: number;
}

function lengthNorm(length: number, average: number): number {
	return 1 - B + (B * length) / average;
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareScored(a: Scored, b: Scored): number {
	return (
		b.score - a.score ||
		Number(a.file.type === TASK_SPEC) - Number(b.file.type === TASK_SPEC) ||
		compareText(a.file.path, b.file.path) ||
		a.section.line - b.section.line
	);
}

function rank(index: SectionIndex, query: ParsedQuery, filters: SpecFilters): Scored[] {
	const scored: Scored[] = [];
	if (query.terms.every((term) => term.options.length === 0)) return scored;
	for (const file of index.files.values()) {
		if (!matchesFilters(file.frontmatter, filters)) continue;
		const titleNorm = lengthNorm(file.titleLength, index.averages.title);
		for (const section of file.sections) {
			const headingNorm = lengthNorm(section.headingLength, index.averages.heading);
			const bodyNorm = lengthNorm(section.bodyLength, index.averages.body);
			let score = 0;
			let covered = 0;
			let matched = 0;
			for (const term of query.terms) {
				let best = 0;
				for (const option of term.options) {
					const tf =
						(TITLE_WEIGHT * countOf(file.titleTerms, option.term)) / titleNorm +
						(HEADING_WEIGHT * countOf(section.headingTerms, option.term)) / headingNorm +
						(BODY_WEIGHT * countOf(section.bodyTerms, option.term)) / bodyNorm;
					if (tf > 0) best = Math.max(best, (option.weight * option.idf * tf) / (K1 + tf));
				}
				if (best === 0) continue;
				score += best;
				if (!term.joined) {
					matched += 1;
					covered += term.weight;
				}
			}
			if (score === 0) continue;
			const coverage = query.weight > 0 ? covered / query.weight : 1;
			const phrase = query.phrase !== null && section.flat.includes(query.phrase);
			scored.push({
				file,
				section,
				score: score * coverage * coverage * (phrase ? PHRASE_BOOST : 1),
				matched,
			});
		}
	}
	return scored.sort(compareScored);
}

function rangesIn(text: string, terms: ReadonlySet<string>): TextRange[] {
	const ranges = tokenize(text)
		.filter((token) => terms.has(token.term))
		.map((token): TextRange => [token.start, token.end])
		.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const merged: TextRange[] = [];
	for (const [start, end] of ranges) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

function displayLine(line: string): string {
	return cleanInline(line.replace(QUOTE_MARKER, "").replace(LIST_MARKER, ""));
}

function cut(text: string, ranges: readonly TextRange[]): { text: string; ranges: TextRange[] } {
	if (text.length <= SNIPPET_CHARS) return { text, ranges: [...ranges] };
	const first = ranges[0]?.[0] ?? 0;
	let start = Math.max(0, Math.min(first - SNIPPET_LEAD, text.length - SNIPPET_CHARS));
	if (start > 0) {
		const space = text.lastIndexOf(" ", start);
		if (space !== -1 && start - space <= SNIPPET_WORD_SLACK) start = space + 1;
	}
	let end = Math.min(text.length, start + SNIPPET_CHARS);
	if (end < text.length) {
		const space = text.lastIndexOf(" ", end);
		if (space > first && end - space <= SNIPPET_WORD_SLACK) end = space;
	}
	const prefix = start > 0 ? "…" : "";
	const body = text.slice(start, end).trimEnd();
	const shifted = ranges
		.filter(([a, b]) => b > start && a < start + body.length)
		.map(
			([a, b]): TextRange => [
				Math.max(a, start) - start + prefix.length,
				Math.min(b, start + body.length) - start + prefix.length,
			],
		);
	return { text: `${prefix}${body}${end < text.length ? "…" : ""}`, ranges: shifted };
}

interface SnippetLine {
	readonly text: string;
	readonly line: number;
	readonly ranges: TextRange[];
	readonly distinct: number;
	readonly phrase: boolean;
}

function better(candidate: SnippetLine, best: SnippetLine | null): boolean {
	if (best === null) return true;
	if (candidate.distinct !== best.distinct) return candidate.distinct > best.distinct;
	if (candidate.phrase !== best.phrase) return candidate.phrase;
	return candidate.ranges.length > best.ranges.length;
}

function snippetOf(
	section: IndexedSection,
	query: ParsedQuery,
): { text: string; line: number; ranges: TextRange[] } {
	let best: SnippetLine | null = null;
	let fallback: { text: string; line: number } | null = null;
	for (const [offset, raw] of section.body.entries()) {
		if (FENCE_LINE.test(raw)) continue;
		const text = displayLine(raw);
		if (text === "") continue;
		const line = section.bodyLine + offset;
		fallback ??= { text, line };
		const matches = tokenize(text).filter((token) => query.matchTerms.has(token.term));
		if (matches.length === 0) continue;
		const candidate: SnippetLine = {
			text,
			line,
			ranges: rangesIn(text, query.matchTerms),
			distinct: new Set(matches.map((token) => token.term)).size,
			phrase: query.phrase !== null && ` ${flatten(text)}`.includes(query.phrase),
		};
		if (better(candidate, best)) best = candidate;
	}
	if (best !== null) {
		const shown = cut(best.text, best.ranges);
		return { text: shown.text, line: best.line, ranges: shown.ranges };
	}
	if (fallback !== null)
		return { text: cut(fallback.text, []).text, line: fallback.line, ranges: [] };
	return { text: "", line: section.line, ranges: [] };
}

function hitOf(scored: Scored, query: ParsedQuery, score: number): SpecSectionHit {
	const { file, section } = scored;
	const heading = section.headings.join(" › ");
	const snippet = snippetOf(section, query);
	return {
		path: file.path,
		id: file.id,
		title: file.title,
		type: file.type,
		heading,
		line: section.line,
		endLine: section.endLine,
		snippet: snippet.text,
		snippetLine: snippet.line,
		ranges: {
			title: rangesIn(file.title, query.matchTerms),
			heading: rangesIn(heading, query.matchTerms),
			snippet: snippet.ranges,
		},
		score,
		matched: scored.matched,
		terms: query.words,
	};
}

interface Fused {
	scored: Scored;
	query: ParsedQuery;
	score: number;
	position: number;
}

export function searchSpecs(
	index: SectionIndex,
	query: string | readonly string[],
	options: SpecSearchOptions = {},
): SpecSearchResult {
	const texts = [
		...new Set(
			(typeof query === "string" ? [query] : query)
				.map((text) => text.trim())
				.filter((text) => text !== ""),
		),
	];
	const requested = Math.trunc(options.limit ?? DEFAULT_SPEC_SEARCH_LIMIT);
	const limit = requested > 0 ? requested : DEFAULT_SPEC_SEARCH_LIMIT;
	const queries = texts.map((text) => parseQuery(index, text));
	const fused = new Map<IndexedSection, Fused>();
	queries.forEach((parsed) => {
		rank(index, parsed, options).forEach((scored, position) => {
			const share = queries.length === 1 ? scored.score : 1 / (RRF_K + position + 1);
			const known = fused.get(scored.section);
			if (known === undefined) {
				fused.set(scored.section, { scored, query: parsed, score: share, position });
				return;
			}
			known.score += share;
			if (position < known.position) {
				known.position = position;
				known.scored = scored;
				known.query = parsed;
			}
		});
	});
	const ordered = [...fused.values()].sort(
		(a, b) => b.score - a.score || compareScored(a.scored, b.scored),
	);
	return {
		hits: ordered.slice(0, limit).map((entry) => hitOf(entry.scored, entry.query, entry.score)),
		total: ordered.length,
	};
}
