import { stat } from "node:fs/promises";
import type { EventBody, IssuedCall, TraceEvent } from "./core.ts";
import { eventBody, type ParsedSource } from "./eventBody.ts";
import { type ByteRange, parseLine, readRange, scanFile, sliceYielder } from "./lines.ts";
import { createRedactor, maskSecretFields, type Redactor } from "./redact.ts";
import { isRecord } from "./totals.ts";
import {
	type BuiltTrace,
	buildTrace,
	contentText,
	EntryCollector,
	type EventSource,
} from "./trace.ts";

export interface TraceStoreOptions {
	redactor?: Redactor;
	/** Traces kept in memory, least recently used first out. */
	capacity?: number;
	sliceMs?: number;
	/** Once aborted, a build stops at its next yield and builds nothing. */
	signal?: AbortSignal;
}

export interface LoadedEvent {
	trace: BuiltTrace;
	event: TraceEvent;
	body: EventBody;
}

/** An event's entries as pi wrote them, verified against the skeleton; bodies stay inside the engine. */
export interface ReadEvent {
	trace: BuiltTrace;
	event: TraceEvent;
	source: EventSource;
	parsed: ParsedSource;
}

export interface TraceSearch {
	trace: BuiltTrace;
	ids: string[];
	truncated: boolean;
}

interface Cached {
	size: number;
	mtimeMs: number;
	trace: BuiltTrace;
	byId: Map<string, TraceEvent>;
}

const CAPACITY = 4;
const SLICE_MS = 8;
/** Snapshots a pager pinned, kept per file after the file moved on (the newest first out last). */
const PINNED_PER_FILE = 2;

function revisionOf(info: { size: number; mtimeMs: number }): string {
	return `${info.size}:${Math.round(info.mtimeMs)}`;
}

function searchableTexts(entry: Record<string, unknown>): { text: string[]; calls: string[] } {
	const calls: string[] = [];
	const text: string[] = [];
	if (entry.type === "message" && isRecord(entry.message)) {
		const message = entry.message;
		const content = Array.isArray(message.content) ? message.content : [];
		text.push(contentText(message.content));
		if (typeof message.errorMessage === "string") text.push(message.errorMessage);
		if (typeof message.command === "string") text.push(message.command);
		for (const block of content) {
			if (!isRecord(block)) continue;
			if (block.type === "thinking" && typeof block.thinking === "string")
				text.push(block.thinking);
			if (block.type === "toolCall")
				calls.push(JSON.stringify(maskSecretFields(block.arguments ?? {})));
		}
	} else {
		text.push(contentText(entry.content));
		for (const key of ["summary", "name", "label"] as const) {
			const value = entry[key];
			if (typeof value === "string") text.push(value);
		}
	}
	return { text, calls };
}

function labelTexts(event: TraceEvent): string[] {
	switch (event.kind) {
		case "llm":
			return [event.label, event.model ?? ""];
		case "tool":
			return [event.label, event.tool, event.head ?? ""];
		case "subagent":
			return [event.label, event.role ?? "", event.status ?? ""];
		case "mark":
			return [event.label, event.detail ?? ""];
		case "turn":
			return [event.label];
	}
}

/** Builds traces on demand, keeps the latest few, and re-reads bodies from the pi file by offset. */
export class TraceStore {
	private readonly redactor: Redactor;
	private readonly capacity: number;
	private readonly sliceMs: number;
	private readonly signal: AbortSignal | undefined;
	private readonly cache = new Map<string, Cached>();
	private readonly building = new Map<string, Promise<Cached | null>>();
	private readonly pins = new Map<string, Cached[]>();

	constructor(options: TraceStoreOptions = {}) {
		this.redactor = options.redactor ?? createRedactor();
		this.capacity = options.capacity ?? CAPACITY;
		this.sliceMs = options.sliceMs ?? SLICE_MS;
		this.signal = options.signal;
	}

	async trace(file: string): Promise<BuiltTrace | null> {
		return (await this.load(file))?.trace ?? null;
	}

	/** A trace without making it one of the latest few: a child transcript read for its activity. */
	async peek(file: string): Promise<BuiltTrace | null> {
		const cached = this.cache.get(file);
		try {
			const stats = await stat(file);
			if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs)
				return cached.trace;
			if (!stats.isFile()) return null;
			return (await this.build(file, { size: stats.size, mtimeMs: stats.mtimeMs }))?.trace ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * The trace a pager reads. Given the `revision` its first page carried: that snapshot while it is
	 * retained (the current one, or one of the last `PINNED_PER_FILE` a pager was served per file), with
	 * whether the file has moved past it, so paging finishes on one revision. Otherwise the current
	 * trace, which this pins.
	 */
	async traceAt(
		file: string,
		revision?: string,
	): Promise<{ trace: BuiltTrace; newerRevision: boolean } | null> {
		const kept = revision === undefined ? undefined : this.pinned(file, revision);
		if (kept) {
			let current: string | null = null;
			try {
				current = revisionOf(await stat(file));
			} catch {}
			return { trace: kept.trace, newerRevision: current !== revision };
		}
		const cached = await this.load(file);
		if (!cached) return null;
		const pinned = (this.pins.get(file) ?? []).filter(
			(other) => other.trace.meta.revision !== cached.trace.meta.revision,
		);
		pinned.push(cached);
		this.pins.delete(file);
		this.pins.set(file, pinned.slice(-PINNED_PER_FILE));
		while (this.pins.size > this.capacity) {
			const oldest = this.pins.keys().next().value;
			if (oldest === undefined) break;
			this.pins.delete(oldest);
		}
		return { trace: cached.trace, newerRevision: false };
	}

	private pinned(file: string, revision: string): Cached | undefined {
		const cached = this.cache.get(file);
		if (cached?.trace.meta.revision === revision) return cached;
		return this.pins.get(file)?.find((other) => other.trace.meta.revision === revision);
	}

	/** The redactor bodies go through, for analyses that cap text of their own. */
	get redaction(): Redactor {
		return this.redactor;
	}

	/** Re-reads an event's entries by offset; a rewritten file rebuilds the skeleton once. */
	async read(file: string, eventId: string): Promise<ReadEvent | null> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const cached = await this.load(file);
			const event = cached?.byId.get(eventId);
			const source = cached?.trace.sources.get(eventId);
			if (!cached || !event || !source) return null;
			const parsed = await this.readSource(file, source);
			if (!parsed) {
				this.cache.delete(file);
				continue;
			}
			return { trace: cached.trace, event, source, parsed };
		}
		return null;
	}

	async event(file: string, eventId: string): Promise<LoadedEvent | null> {
		const read = await this.read(file, eventId);
		if (!read) return null;
		const { trace, event, source, parsed } = read;
		const issued: IssuedCall[] =
			event.kind === "llm"
				? trace.events.flatMap((candidate) =>
						candidate.kind === "tool" && candidate.parent === event.id
							? [{ toolCallId: candidate.toolCallId, name: candidate.tool, eventId: candidate.id }]
							: [],
					)
				: [];
		return { trace, event, body: eventBody(this.redactor, event, source, parsed, issued) };
	}

	/** The pi entry *Open in chat* should land on for an event, and the tool call inside it; no body is read. */
	async locate(
		file: string,
		eventId: string,
	): Promise<{ anchorEntryId: string; toolCallId: string | null } | null> {
		const cached = await this.load(file);
		const event = cached?.byId.get(eventId);
		const source = cached?.trace.sources.get(eventId);
		if (!event || !source) return null;
		return {
			anchorEntryId: source.entryId,
			toolCallId:
				event.kind === "tool" || event.kind === "subagent" ? (source.toolCallId ?? null) : null,
		};
	}

	async search(file: string, query: string, maxIds: number): Promise<TraceSearch | null> {
		const cached = await this.load(file);
		if (!cached) return null;
		const needle = query.toLowerCase();
		const trace = cached.trace;
		const hits = new Set<string>();
		for (const event of trace.events)
			if (labelTexts(event).some((text) => text.toLowerCase().includes(needle))) hits.add(event.id);
		const matches = (text: string) => text.toLowerCase().includes(needle);
		await scanFile(
			file,
			0,
			cached.size,
			(entry) => {
				if (!isRecord(entry)) return;
				const ref = typeof entry.id === "string" ? trace.entries.get(entry.id) : undefined;
				if (!ref) return;
				const { text, calls } = searchableTexts(entry);
				if (text.some(matches)) hits.add(ref.event);
				calls.forEach((args, index) => {
					const call = ref.calls?.[index];
					if (call && matches(args)) hits.add(call);
				});
			},
			sliceYielder(this.sliceMs),
		);
		const ids = trace.events.filter((event) => hits.has(event.id)).map((event) => event.id);
		return { trace, ids: ids.slice(0, maxIds), truncated: ids.length > maxIds };
	}

	private async readSource(
		file: string,
		source: EventSource,
	): Promise<{ entry: Record<string, unknown>; result: Record<string, unknown> | null } | null> {
		try {
			const entry = parseLine(await readRange(file, source.range));
			if (!isRecord(entry) || !this.sameEntry(entry, source.entryId, source.range)) return null;
			if (!source.result) return { entry, result: null };
			const result = parseLine(await readRange(file, source.result.range));
			if (!isRecord(result) || !this.sameEntry(result, source.result.entryId, source.result.range))
				return null;
			return { entry, result };
		} catch {
			return null;
		}
	}

	private sameEntry(entry: Record<string, unknown>, id: string, range: ByteRange): boolean {
		return typeof entry.id === "string" ? entry.id === id : id === `@${range.offset}`;
	}

	private async load(file: string): Promise<Cached | null> {
		let info: { size: number; mtimeMs: number };
		try {
			const stats = await stat(file);
			if (!stats.isFile()) return null;
			info = { size: stats.size, mtimeMs: stats.mtimeMs };
		} catch {
			this.cache.delete(file);
			return null;
		}
		const cached = this.cache.get(file);
		if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
			this.cache.delete(file);
			this.cache.set(file, cached);
			return cached;
		}
		const key = `${file}\u0000${info.size}\u0000${info.mtimeMs}`;
		let pending = this.building.get(key);
		if (!pending) {
			pending = this.build(file, info).finally(() => this.building.delete(key));
			this.building.set(key, pending);
		}
		const built = await pending;
		if (!built) return null;
		this.cache.delete(file);
		this.cache.set(file, built);
		while (this.cache.size > this.capacity) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
		return built;
	}

	private async build(
		file: string,
		info: { size: number; mtimeMs: number },
	): Promise<Cached | null> {
		const collector = new EntryCollector(this.redactor);
		try {
			const { tail } = await scanFile(
				file,
				0,
				info.size,
				(entry, range) => collector.add(entry, range),
				sliceYielder(this.sliceMs, undefined, this.signal),
			);
			if (tail) collector.add(tail.entry, tail.range);
		} catch {
			return null;
		}
		const collected = collector.result();
		if (!collected) return null;
		const trace = buildTrace(file, revisionOf(info), collected);
		return {
			...info,
			trace,
			byId: new Map(trace.events.map((event) => [event.id, event])),
		};
	}
}
