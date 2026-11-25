import { stat } from "node:fs/promises";
import { CACHE_VERSION, type SummaryCache } from "./cache.ts";
import type { IndexState } from "./core.ts";
import { type ChildTranscriptLocator, listJsonlFiles } from "./discovery.ts";
import { parseLine, readRange, scanFile, sliceYielder, tailHash, type Yielder } from "./lines.ts";
import { createRedactor, type Redactor } from "./redact.ts";
import {
	PARSER_VERSION,
	promptExcerpt,
	type SessionSummary,
	SummaryBuilder,
	type SummaryState,
	toSummary,
} from "./summary.ts";
import { isRecord } from "./totals.ts";

export interface SessionIndexOptions {
	sessionFiles: () => Promise<readonly string[]>;
	childTranscriptDirs: ChildTranscriptLocator;
	cache?: SummaryCache;
	/** What titles and first-prompt excerpts go through before they leave the index (default: this machine's home). */
	redactor?: Redactor;
	revalidateMs?: number;
	sliceMs?: number;
	now?: () => number;
	onError?: (error: unknown) => void;
	/** Stops the index for good: a running revalidation ends at its next yield and writes no cache, none starts again. */
	signal?: AbortSignal;
}

const REVALIDATE_MS = 2000;
const SLICE_MS = 8;
const FRESH_BUDGET_MS = 150;

interface FileRecord {
	size: number;
	mtimeMs: number;
	consumed: number;
	tailHash: string;
	appendable: boolean;
	state: SummaryState;
	final: SummaryState | null;
	children: readonly string[];
	summary: SessionSummary | null;
	prompt?: Promise<string | null>;
}

interface ChildDirs {
	size: number;
	mtimeMs: number;
	dirs: readonly string[];
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isState(value: unknown): value is SummaryState {
	if (!isRecord(value)) return false;
	const { header } = value;
	return (
		(header === null ||
			(isRecord(header) && typeof header.id === "string" && typeof header.cwd === "string")) &&
		["counts", "tools", "stopReasons", "spend", "models", "subagents"].every((key) =>
			isRecord(value[key]),
		)
	);
}

/** The summary with its title redacted, as every summary the index hands out. */
function redactedSummary(
	state: SummaryState,
	path: string,
	redactor: Redactor,
): SessionSummary | null {
	const summary = toSummary(state, path);
	return summary?.title ? { ...summary, title: redactor.clean(summary.title) } : summary;
}

function restoreRecord(path: string, value: unknown, redactor: Redactor): FileRecord | null {
	if (!isRecord(value)) return null;
	const { size, mtimeMs, consumed, tailHash, appendable, state, final, children } = value;
	if (
		typeof size !== "number" ||
		typeof mtimeMs !== "number" ||
		typeof consumed !== "number" ||
		typeof tailHash !== "string" ||
		typeof appendable !== "boolean" ||
		!isState(state) ||
		!(final === null || isState(final)) ||
		!isStringArray(children)
	)
		return null;
	return {
		size,
		mtimeMs,
		consumed,
		tailHash,
		appendable,
		state,
		final,
		children,
		summary: redactedSummary(final ?? state, path, redactor),
	};
}

function persisted(record: FileRecord) {
	const { size, mtimeMs, consumed, tailHash, appendable, state, final, children } = record;
	return { size, mtimeMs, consumed, tailHash, appendable, state, final, children };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, index) => item === b[index]);
}

export class SessionIndex {
	private readonly options: SessionIndexOptions;
	private readonly redactor: Redactor;
	private readonly revalidateMs: number;
	private readonly sliceMs: number;
	private readonly now: () => number;
	private readonly signal: AbortSignal | undefined;
	private readonly parents = new Map<string, FileRecord>();
	private readonly children = new Map<string, FileRecord>();
	private readonly childDirs = new Map<string, ChildDirs>();
	private readonly cached = new Map<string, FileRecord>();
	private cacheLoaded = false;
	private refreshing: Promise<void> | null = null;
	private forced = false;
	private built = false;
	private lastCheck = 0;
	private indexed = 0;
	private total: number | null = null;
	private dirty = false;
	private version = 0;
	private sortedVersion = -1;
	private sorted: { summaries: SessionSummary[]; byId: Map<string, string> } = {
		summaries: [],
		byId: new Map(),
	};

	constructor(options: SessionIndexOptions) {
		this.options = options;
		this.redactor = options.redactor ?? createRedactor();
		this.revalidateMs = options.revalidateMs ?? REVALIDATE_MS;
		this.sliceMs = options.sliceMs ?? SLICE_MS;
		this.now = options.now ?? Date.now;
		this.signal = options.signal;
	}

	/**
	 * Revalidates when `revalidateMs` passed since the last revalidation ended, or at once with `fresh`
	 * (right after the running one, if any), and waits up to `budgetMs` for it.
	 */
	async ensureFresh(
		budgetMs: number = FRESH_BUDGET_MS,
		options: { fresh?: boolean } = {},
	): Promise<IndexState> {
		this.kick(options.fresh === true);
		if (this.refreshing && budgetMs > 0) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let expired = false;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					expired = true;
					resolve();
				}, budgetMs);
			});
			for (let running = this.running(); running && !expired; running = this.running())
				await Promise.race([running, timeout]);
			clearTimeout(timer);
		}
		return this.state();
	}

	/** The revalidation in flight (a forced one may follow the one awaited). */
	private running(): Promise<void> | null {
		return this.refreshing;
	}

	state(): IndexState {
		const phase = !this.built ? "cold" : this.refreshing ? "refreshing" : "ready";
		return { phase, indexed: this.indexed, total: this.total };
	}

	summaries(): readonly SessionSummary[] {
		return this.view().summaries;
	}

	childSummary(file: string): SessionSummary | undefined {
		return (this.children.get(file) ?? this.cached.get(file))?.summary ?? undefined;
	}

	/** The indexed summary of a session file, the first one listed when two files share an id. */
	summaryOf(sessionId: string): SessionSummary | undefined {
		const path = this.view().byId.get(sessionId);
		return path ? (this.parents.get(path)?.summary ?? undefined) : undefined;
	}

	childFiles(sessionId: string): readonly string[] {
		const path = this.view().byId.get(sessionId);
		return (path && this.parents.get(path)?.children) || [];
	}

	firstPrompt(sessionId: string): Promise<string | null> {
		const path = this.view().byId.get(sessionId);
		const record = path ? this.parents.get(path) : undefined;
		const range = record?.summary?.firstPrompt;
		if (!path || !record || !range) return Promise.resolve(null);
		record.prompt ??= readRange(path, range).then(
			(bytes) => promptExcerpt(parseLine(bytes), this.redactor),
			() => null,
		);
		return record.prompt;
	}

	private view(): { summaries: SessionSummary[]; byId: Map<string, string> } {
		if (this.sortedVersion === this.version) return this.sorted;
		const summaries: SessionSummary[] = [];
		const byId = new Map<string, string>();
		for (const path of [...this.parents.keys()].sort()) {
			const summary = this.parents.get(path)?.summary;
			if (!summary) continue;
			summaries.push(summary);
			if (!byId.has(summary.sessionId)) byId.set(summary.sessionId, path);
		}
		this.sorted = { summaries, byId };
		this.sortedVersion = this.version;
		return this.sorted;
	}

	private report(error: unknown): void {
		try {
			this.options.onError?.(error);
		} catch {}
	}

	private takeCached(path: string): FileRecord | undefined {
		const record = this.cached.get(path);
		this.cached.delete(path);
		return record;
	}

	private changed(): void {
		this.dirty = true;
		this.version += 1;
	}

	private kick(force = false): void {
		if (this.signal?.aborted) return;
		if (this.refreshing) {
			if (force) this.forced = true;
			return;
		}
		if (!force && this.built && this.now() - this.lastCheck < this.revalidateMs) return;
		this.refreshing = this.refresh()
			.catch((error: unknown) => {
				if (!this.signal?.aborted) this.report(error);
			})
			.finally(() => {
				this.built = true;
				this.refreshing = null;
				this.lastCheck = this.now();
				if (this.forced) {
					this.forced = false;
					this.kick(true);
				}
			});
	}

	private async refresh(): Promise<void> {
		const yielder = sliceYielder(this.sliceMs, undefined, this.signal);
		if (!this.cacheLoaded) await this.loadCache();
		const files = [...(await this.options.sessionFiles())].sort();
		this.indexed = 0;
		this.total = files.length;
		const listed = new Set(files);
		for (const path of [...this.parents.keys()]) {
			if (listed.has(path)) continue;
			this.parents.delete(path);
			this.childDirs.delete(path);
			this.changed();
		}
		for (const path of files) {
			const cached = this.takeCached(path);
			if (cached && !this.parents.has(path)) {
				this.parents.set(path, cached);
				this.version += 1;
			}
		}
		const seenChildren = new Set<string>();
		for (const path of files) {
			const prior = this.parents.get(path);
			const record = await this.revalidate(path, prior, yielder);
			if (record !== prior) {
				if (record) this.parents.set(path, record);
				else this.parents.delete(path);
				this.changed();
			}
			if (record?.summary) await this.refreshChildren(path, record, seenChildren, yielder);
			this.indexed += 1;
			if (yielder.due()) await yielder.pause();
		}
		for (const path of [...this.children.keys()]) {
			if (seenChildren.has(path)) continue;
			this.children.delete(path);
			this.changed();
		}
		if (this.cached.size > 0) {
			this.cached.clear();
			this.dirty = true;
		}
		this.built = true;
		if (this.dirty) await this.saveCache();
	}

	private async refreshChildren(
		parentPath: string,
		parent: FileRecord,
		seen: Set<string>,
		yielder: Yielder,
	): Promise<void> {
		const summary = parent.summary;
		if (!summary) return;
		let located = this.childDirs.get(parentPath);
		if (!located || located.size !== parent.size || located.mtimeMs !== parent.mtimeMs) {
			let dirs: readonly string[] = [];
			try {
				dirs = await this.options.childTranscriptDirs({
					sessionId: summary.sessionId,
					cwd: summary.cwd,
				});
			} catch (error) {
				this.report(error);
			}
			located = { size: parent.size, mtimeMs: parent.mtimeMs, dirs: [...dirs].sort() };
			this.childDirs.set(parentPath, located);
		}
		const files = (await Promise.all(located.dirs.map(listJsonlFiles))).flat();
		const kept: string[] = [];
		for (const file of files) {
			if (seen.has(file) || this.parents.has(file)) continue;
			seen.add(file);
			const prior = this.children.get(file) ?? this.takeCached(file);
			const record = await this.revalidate(file, prior, yielder);
			if (record !== prior) {
				if (record) this.children.set(file, record);
				else this.children.delete(file);
				this.changed();
			} else if (record && !this.children.has(file)) {
				this.children.set(file, record);
				this.version += 1;
			}
			if (record?.summary) kept.push(file);
		}
		if (!sameList(parent.children, kept)) {
			parent.children = kept;
			this.changed();
		}
	}

	private async revalidate(
		path: string,
		prior: FileRecord | undefined,
		yielder: Yielder,
	): Promise<FileRecord | null> {
		try {
			const info = await stat(path);
			if (!info.isFile()) return null;
			const { size, mtimeMs } = info;
			if (prior && prior.size === size && prior.mtimeMs === mtimeMs) return prior;
			const resumable =
				prior?.appendable === true &&
				size > prior.size &&
				(await tailHash(path, prior.consumed)) === prior.tailHash;
			const record = await this.parse(path, size, mtimeMs, resumable ? prior : undefined, yielder);
			if (prior) record.children = prior.children;
			return record;
		} catch (error) {
			if (this.signal?.aborted) throw error;
			return null;
		}
	}

	private async parse(
		path: string,
		size: number,
		mtimeMs: number,
		resume: FileRecord | undefined,
		yielder: Yielder,
	): Promise<FileRecord> {
		const builder = new SummaryBuilder(resume?.state);
		const { consumed, tail } = await scanFile(
			path,
			resume?.consumed ?? 0,
			size,
			(entry, range) => builder.add(entry, range),
			yielder,
		);
		const folded = builder.finish(tail);
		const summary = redactedSummary(folded.final, path, this.redactor);
		const record: FileRecord = {
			size,
			mtimeMs,
			consumed,
			tailHash: await tailHash(path, consumed),
			appendable: folded.appendable,
			state: folded.state,
			final: folded.final === folded.state ? null : folded.final,
			children: [],
			summary,
		};
		const range = summary?.firstPrompt;
		const priorRange = resume?.summary?.firstPrompt;
		if (resume?.prompt && range && priorRange?.offset === range.offset)
			record.prompt = resume.prompt;
		return record;
	}

	private async loadCache(): Promise<void> {
		this.cacheLoaded = true;
		const cache = this.options.cache;
		if (!cache) return;
		try {
			const document = await cache.load();
			if (
				!isRecord(document) ||
				document.cacheVersion !== CACHE_VERSION ||
				document.parserVersion !== PARSER_VERSION ||
				!isRecord(document.files)
			)
				return;
			for (const [path, value] of Object.entries(document.files)) {
				const record = restoreRecord(path, value, this.redactor);
				if (record) this.cached.set(path, record);
			}
		} catch (error) {
			this.report(error);
		}
	}

	private async saveCache(): Promise<void> {
		const cache = this.options.cache;
		if (this.signal?.aborted) return;
		this.dirty = false;
		if (!cache) return;
		const files: Record<string, unknown> = {};
		for (const [path, record] of [...this.parents, ...this.children].sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0,
		))
			files[path] = persisted(record);
		try {
			await cache.save(
				{ cacheVersion: CACHE_VERSION, parserVersion: PARSER_VERSION, files },
				this.signal,
			);
		} catch (error) {
			this.dirty = true;
			if (!this.signal?.aborted) this.report(error);
		}
	}
}
