import { open } from "node:fs/promises";
import {
	type FacetCount,
	type FacetValues,
	type IndexState,
	type ParsedSearch,
	SEARCH_RULES,
	SESSION_INSIGHTS_API_VERSION,
	type SearchFacets,
	type SearchGroup,
	type SearchHit,
	type SearchStatus,
	type SearchVocabulary,
	type SessionListRow,
	type SessionRef,
	type SessionsSearchParams,
	type SessionsSearchResult,
} from "./core.ts";
import { refOf, type StatsInput } from "./crossSession.ts";
import { sliceYielder } from "./lines.ts";
import { listRows, projectsOf } from "./list.ts";
import { createRedactor, type Redactor } from "./redact.ts";
import {
	type CompiledFilters,
	compileFilters,
	filterPlan,
	type SearchColumns,
	searchStrings,
} from "./searchIndex.ts";
import { parseSearchQuery } from "./searchQuery.ts";
import {
	type CompiledTerm,
	compileTerms,
	linePlan,
	readHits,
	type ScanControl,
	type ScanCursor,
	scanLines,
} from "./searchScan.ts";
import type { SessionSummary } from "./summary.ts";

export interface SearchJobsOptions {
	redactor?: Redactor;
	/** How long one request scans (`SEARCH_RULES.budgetMs` by default). */
	budgetMs?: number;
	sliceMs?: number;
	/** Panels whose latest search is kept. */
	clients?: number;
	/** Off only in tests: every planned line is parsed, to check the byte prefilter against a full parse. */
	prefilter?: boolean;
	/** Cancels every job at its next yield and drops them; later requests answer `superseded`. */
	signal?: AbortSignal;
}

interface Row {
	row: SessionListRow;
	summary: SessionSummary;
	projectName: string;
}

interface Tally {
	tool: Map<number, number>;
	model: Map<number, number>;
	skill: Map<number, number>;
	project: Map<string, number>;
	yes: number;
	no: number;
}

interface Job {
	seq: number;
	parsed: ParsedSearch;
	terms: CompiledTerm[];
	filters: CompiledFilters;
	/** Nothing to look for: no terms and no filters. */
	empty: boolean;
	rows: Row[];
	/** The sessions in `rows`, so a session indexed after the job started is appended once. */
	listed: Set<string>;
	/** The index was ready when `rows` were last listed: no session can join any more. */
	complete: boolean;
	/** The next row to read, and the next read row to show. */
	scanPos: number;
	emitPos: number;
	/** A row whose lines were read only in part when the time ran out. */
	partial: { row: number; cursor: ScanCursor; candidates: Int32Array } | null;
	matches: Map<number, Int32Array>;
	columns: Map<number, SearchColumns>;
	shown: Map<number, number>;
	pageEvents: number;
	status: SearchStatus;
	step: number;
	events: number;
	sessions: number;
	tally: Tally;
	cancelled: boolean;
	chain: Promise<unknown>;
}

interface Client {
	seq: number;
	job: Job | null;
}

interface Emitted {
	row: number;
	matches: number;
	shown: number;
	events: SearchHit[];
	more: string | null;
}

const NO_FACETS: SearchFacets = {
	tool: { values: [], others: 0 },
	model: { values: [], others: 0 },
	skill: { values: [], others: 0 },
	project: { values: [], others: 0 },
	error: { yes: 0, no: 0 },
};

function byCount(a: FacetCount, b: FacetCount): number {
	return b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
}

function ranked(counts: Iterable<[string, number]>, limit: number): FacetCount[] {
	const merged = new Map<string, number>();
	for (const [value, count] of counts) merged.set(value, (merged.get(value) ?? 0) + count);
	return [...merged]
		.map(([value, count]) => ({ value, count }))
		.sort(byCount)
		.slice(0, limit);
}

function facetOf(counts: Iterable<[string, number]>): FacetValues {
	const all = ranked(counts, Number.POSITIVE_INFINITY);
	const values = all.slice(0, SEARCH_RULES.facetValues);
	return {
		values,
		others: all.slice(SEARCH_RULES.facetValues).reduce((sum, item) => sum + item.count, 0),
	};
}

function named(counts: Map<number, number>): [string, number][] {
	return [...counts].map(([id, count]) => [searchStrings.value(id), count]);
}

function emptyTally(): Tally {
	return { tool: new Map(), model: new Map(), skill: new Map(), project: new Map(), yes: 0, no: 0 };
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
	map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * Searches across the scope's sessions, one job per panel. Facets come from each session's search
 * columns (built with its digest); free text is matched by reading only the candidate events' lines,
 * newest session first, with a byte prefilter. A job stops early once a page is full and remembers
 * where it is, so `next` continues it; a newer `seq` from the same panel cancels the older scan.
 */
export class SearchJobs {
	private readonly redactor: Redactor;
	private readonly budgetMs: number;
	private readonly sliceMs: number;
	private readonly capacity: number;
	private readonly prefilter: boolean;
	private readonly clients = new Map<string, Client>();
	private readonly signal: AbortSignal | undefined;

	constructor(options: SearchJobsOptions = {}) {
		this.redactor = options.redactor ?? createRedactor();
		this.budgetMs = options.budgetMs ?? SEARCH_RULES.budgetMs;
		this.sliceMs = options.sliceMs ?? 8;
		this.capacity = options.clients ?? 16;
		this.prefilter = options.prefilter ?? true;
		this.signal = options.signal;
		this.signal?.addEventListener(
			"abort",
			() => {
				for (const client of this.clients.values()) if (client.job) client.job.cancelled = true;
				this.clients.clear();
			},
			{ once: true },
		);
	}

	async run(
		input: StatsInput,
		state: IndexState,
		params: SessionsSearchParams,
	): Promise<SessionsSearchResult> {
		const parsed = parseSearchQuery(params.query);
		if (this.signal?.aborted) return this.idle(state, params, parsed, "superseded");
		const client = this.clientOf(params.client);
		if (params.seq < client.seq) return this.idle(state, params, parsed, "superseded");
		const current = params.seq === client.seq ? client.job : null;
		const cursor = params.cursor ?? null;
		if (cursor === null || !current) {
			if (cursor !== null) return this.idle(state, params, parsed, "expired");
			if (client.job) client.job.cancelled = true;
			client.seq = params.seq;
			client.job = null;
			const job = await this.create(input, state, params.seq, parsed);
			if (client.seq !== params.seq || this.signal?.aborted)
				return this.idle(state, params, parsed, "superseded");
			client.job = job;
			return this.serialize(job, () => this.advance(input, state, params, job));
		}
		const more = /^(\d+):m:(\d+):(\d+)$/.exec(cursor);
		if (more) {
			const row = Number(more[2]);
			const from = Number(more[3]);
			if (!current.matches.has(row) || (current.shown.get(row) ?? 0) !== from)
				return this.idle(state, params, parsed, "expired");
			return this.serialize(current, async () => {
				const group = await this.emit(current, row, SEARCH_RULES.moreEvents);
				return this.answer(input, state, params, current, group ? [group] : []);
			});
		}
		if (cursor !== `${current.seq}:${current.step}` || current.status === "done")
			return this.idle(state, params, parsed, "expired");
		return this.serialize(current, () => this.advance(input, state, params, current));
	}

	private clientOf(id: string): Client {
		let client = this.clients.get(id);
		if (client) this.clients.delete(id);
		else client = { seq: -1, job: null };
		this.clients.set(id, client);
		while (this.clients.size > this.capacity) {
			const oldest = this.clients.keys().next().value;
			if (oldest === undefined) break;
			const evicted = this.clients.get(oldest);
			if (evicted?.job) evicted.job.cancelled = true;
			this.clients.delete(oldest);
		}
		return client;
	}

	private serialize<T>(job: Job, work: () => Promise<T>): Promise<T> {
		const next = job.chain.then(work);
		job.chain = next.catch(() => {});
		return next;
	}

	/** The scope's rows the filters keep that are not `listed` yet, newest first. */
	private async rowsOf(
		input: StatsInput,
		filters: CompiledFilters,
		listed: ReadonlySet<string>,
	): Promise<Row[]> {
		const names = new Map(input.projects.map((project) => [project.id, project.name]));
		const rows: Row[] = [];
		for (const row of await listRows(input)) {
			if (listed.has(row.sessionId)) continue;
			const summary = input.index.summaryOf(row.sessionId);
			if (!summary) continue;
			const projectName = row.projectId === null ? "" : (names.get(row.projectId) ?? "");
			if (!filters.project(projectName, row.projectId ?? "")) continue;
			if (!filters.labels(input.labelsOf?.(row.sessionId) ?? [])) continue;
			rows.push({ row, summary, projectName });
		}
		return rows;
	}

	/**
	 * While the index is still being built, the sessions it indexed since the job last listed its rows
	 * join the end of the job, so a search started on a cold host reads them too.
	 */
	private async extend(input: StatsInput, state: IndexState, job: Job): Promise<void> {
		if (job.complete) return;
		for (const row of await this.rowsOf(input, job.filters, job.listed)) {
			job.rows.push(row);
			job.listed.add(row.row.sessionId);
		}
		job.complete = state.phase === "ready";
	}

	private async create(
		input: StatsInput,
		state: IndexState,
		seq: number,
		parsed: ParsedSearch,
	): Promise<Job> {
		const filters = compileFilters(filterPlan(parsed.filters));
		const rows = await this.rowsOf(input, filters, new Set());
		const empty = parsed.terms.length === 0 && parsed.filters.length === 0;
		return {
			seq,
			parsed,
			terms: compileTerms(parsed.terms),
			filters,
			empty,
			rows,
			listed: new Set(rows.map((row) => row.row.sessionId)),
			complete: empty || state.phase === "ready",
			scanPos: 0,
			emitPos: 0,
			partial: null,
			matches: new Map(),
			columns: new Map(),
			shown: new Map(),
			pageEvents: 0,
			status: "scanning",
			step: 0,
			events: 0,
			sessions: 0,
			tally: emptyTally(),
			cancelled: false,
			chain: Promise.resolve(),
		};
	}

	private record(
		job: Job,
		index: number,
		columns: SearchColumns | null,
		matches: Int32Array,
	): void {
		job.matches.set(index, matches);
		if (columns) job.columns.set(index, columns);
		job.scanPos = index + 1;
		if (!columns || matches.length === 0) return;
		job.events += matches.length;
		job.sessions += 1;
		const { tally } = job;
		bump(tally.project, job.rows[index]?.projectName ?? "", matches.length);
		for (const pos of matches) {
			if (columns.tool[pos] !== -1) bump(tally.tool, columns.tool[pos] ?? -1);
			if (columns.model[pos] !== -1) bump(tally.model, columns.model[pos] ?? -1);
			bump(tally.skill, columns.skill[pos] ?? -1);
			if (columns.error[pos] === 1) tally.yes += 1;
			else tally.no += 1;
		}
	}

	/** Reads the next row; `false` when it stopped part-way (cancelled or out of time). */
	private async scanRow(input: StatsInput, job: Job, control: ScanControl): Promise<boolean> {
		const index = job.scanPos;
		const row = job.rows[index];
		if (!row) return true;
		const digest = input.digests.get(row.summary) ?? (await input.digests.need(row.summary));
		if (job.cancelled) return false;
		if (!digest) {
			this.record(job, index, null, new Int32Array());
			return true;
		}
		const columns = digest.search;
		const resumed = job.partial?.row === index ? job.partial : null;
		const candidates = resumed?.candidates ?? job.filters.matches(columns);
		if (job.terms.length === 0 || candidates.length === 0) {
			this.record(job, index, columns, job.terms.length === 0 ? candidates : new Int32Array());
			return true;
		}
		const cursor = resumed?.cursor ?? {
			lines: linePlan(columns, candidates),
			next: 0,
			bits: new Uint8Array(columns.length),
		};
		let finished = true;
		try {
			const handle = await open(columns.file, "r");
			try {
				finished = await scanLines(handle, columns, job.terms, cursor, control);
			} finally {
				await handle.close();
			}
		} catch {
			finished = true;
			cursor.bits.fill(0);
		}
		if (!finished) {
			job.partial = { row: index, cursor, candidates };
			return false;
		}
		job.partial = null;
		const all = (1 << job.terms.length) - 1;
		this.record(
			job,
			index,
			columns,
			candidates.filter((pos) => cursor.bits[pos] === all),
		);
		return true;
	}

	/** Filters alone need no file: count the rows whose digests are built, so totals become exact. */
	private countAhead(input: StatsInput, job: Job): void {
		while (job.scanPos < job.rows.length) {
			const row = job.rows[job.scanPos];
			if (!row) break;
			const digest = input.digests.get(row.summary);
			if (digest === undefined) break;
			this.record(
				job,
				job.scanPos,
				digest?.search ?? null,
				digest ? job.filters.matches(digest.search) : new Int32Array(),
			);
		}
	}

	private async emit(job: Job, index: number, limit: number): Promise<Emitted | null> {
		const matches = job.matches.get(index);
		const columns = job.columns.get(index);
		if (!matches || matches.length === 0 || !columns) return null;
		const from = job.shown.get(index) ?? 0;
		const positions = Array.from(matches.subarray(from, from + limit));
		let events: SearchHit[] = [];
		try {
			const handle = await open(columns.file, "r");
			try {
				events = await readHits(handle, columns, positions, job.terms, this.redactor);
			} finally {
				await handle.close();
			}
		} catch {
			events = [];
		}
		const shown = events.length === 0 ? matches.length : from + positions.length;
		job.shown.set(index, shown);
		return {
			row: index,
			matches: matches.length,
			shown,
			events,
			more: shown < matches.length ? `${job.seq}:m:${index}:${shown}` : null,
		};
	}

	/** Whether any row from `emitPos` on, or a session still to be indexed, may still show a match. */
	private hasMore(job: Job): boolean {
		if (!job.complete) return true;
		for (let index = job.emitPos; index < job.rows.length; index++) {
			if (index >= job.scanPos) return true;
			if ((job.matches.get(index)?.length ?? 0) > 0) return true;
		}
		return false;
	}

	private async advance(
		input: StatsInput,
		state: IndexState,
		params: SessionsSearchParams,
		job: Job,
	): Promise<SessionsSearchResult> {
		const started = performance.now();
		const yielder = sliceYielder(this.sliceMs);
		const control: ScanControl = {
			prefilter: this.prefilter,
			keepGoing: async () => {
				if (yielder.due()) await yielder.pause();
				return !job.cancelled && performance.now() - started < this.budgetMs;
			},
		};
		if (job.status === "more") job.pageEvents = 0;
		const groups: Emitted[] = [];
		let progressed = false;
		await this.extend(input, state, job);
		if (job.empty) {
			job.scanPos = job.rows.length;
			job.emitPos = job.rows.length;
		}
		for (;;) {
			if (job.cancelled) {
				job.status = "superseded";
				break;
			}
			while (job.emitPos < job.scanPos && job.pageEvents < SEARCH_RULES.pageEvents) {
				const group = await this.emit(job, job.emitPos, SEARCH_RULES.groupEvents);
				job.emitPos += 1;
				if (group) {
					groups.push(group);
					job.pageEvents += group.events.length || 1;
				}
			}
			if (job.pageEvents >= SEARCH_RULES.pageEvents) {
				if (job.terms.length === 0) {
					await input.digests.ensure(
						job.rows.slice(job.scanPos).map((row) => row.summary),
						Math.max(0, this.budgetMs - (performance.now() - started)),
					);
					this.countAhead(input, job);
				}
				job.status = this.hasMore(job) ? "more" : "done";
				break;
			}
			if (job.scanPos >= job.rows.length) {
				job.status = job.complete ? "done" : "scanning";
				break;
			}
			if (progressed && performance.now() - started >= this.budgetMs) {
				job.status = "scanning";
				break;
			}
			if (!(await this.scanRow(input, job, control))) {
				job.status = job.cancelled ? "superseded" : "scanning";
				break;
			}
			progressed = true;
		}
		if (job.status !== "superseded") job.step += 1;
		return this.answer(input, state, params, job, groups);
	}

	private async vocabulary(input: StatsInput, rows: readonly Row[]): Promise<SearchVocabulary> {
		const progress = await input.digests.ensure(
			rows.map((row) => row.summary),
			input.budgetMs ?? 150,
		);
		const tool: [string, number][] = [];
		const model: [string, number][] = [];
		const skill: [string, number][] = [];
		const file: [string, number][] = [];
		const error: [string, number][] = [];
		const project: [string, number][] = [];
		const label: [string, number][] = [];
		for (const row of rows) {
			const columns = input.digests.latest(row.summary)?.search;
			if (!columns) continue;
			for (const name of input.labelsOf?.(row.row.sessionId) ?? [])
				label.push([name.toLocaleLowerCase("en"), columns.length]);
			tool.push(...named(columns.counts.tool));
			model.push(...named(columns.counts.model));
			skill.push(...named(columns.counts.skill));
			file.push(...named(columns.counts.path));
			error.push(...named(columns.counts.cluster));
			if (row.projectName) project.push([row.projectName, columns.length]);
		}
		const limit = SEARCH_RULES.vocabularyValues;
		return {
			tool: ranked(tool, limit),
			model: ranked(model, limit),
			skill: ranked(skill, limit),
			file: ranked(file, limit),
			error: ranked(error, limit),
			project: ranked(project, limit),
			label: ranked(label, limit),
			complete: progress.ready >= progress.total,
		};
	}

	private async answer(
		input: StatsInput,
		state: IndexState,
		params: SessionsSearchParams,
		job: Job,
		emitted: readonly Emitted[],
	): Promise<SessionsSearchResult> {
		const sessions: SessionRef[] = [];
		const groups: SearchGroup[] = emitted.flatMap((group) => {
			const row = job.rows[group.row];
			if (!row) return [];
			sessions.push(refOf(row.row));
			return [
				{
					session: sessions.length - 1,
					matches: group.matches,
					shown: group.shown,
					events: group.events,
					more: group.more,
				},
			];
		});
		const { tally } = job;
		const continues = job.status === "scanning" || job.status === "more";
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			seq: job.seq,
			status: job.status,
			state,
			digests: await input.digests.ensure(
				job.rows.map((row) => row.summary),
				0,
			),
			query: job.parsed,
			projects: projectsOf(
				input.projects,
				job.rows.map((row) => row.row),
			),
			sessions,
			groups,
			total: {
				events: job.events,
				sessions: job.sessions,
				exact: job.complete && job.scanPos >= job.rows.length,
			},
			scanned: { sessions: job.scanPos, total: job.rows.length },
			facets: {
				tool: facetOf(named(tally.tool)),
				model: facetOf(named(tally.model)),
				skill: facetOf(named(tally.skill)),
				project: facetOf(tally.project),
				error: { yes: tally.yes, no: tally.no },
			},
			vocabulary: params.facets ? await this.vocabulary(input, job.rows) : null,
			next: continues ? `${job.seq}:${job.step}` : null,
		};
	}

	private idle(
		state: IndexState,
		params: SessionsSearchParams,
		parsed: ParsedSearch,
		status: "superseded" | "expired",
	): SessionsSearchResult {
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			seq: params.seq,
			status,
			state,
			digests: { ready: 0, total: 0, stale: 0 },
			query: parsed,
			projects: [],
			sessions: [],
			groups: [],
			total: { events: 0, sessions: 0, exact: false },
			scanned: { sessions: 0, total: 0 },
			facets: NO_FACETS,
			vocabulary: null,
			next: null,
		};
	}
}
