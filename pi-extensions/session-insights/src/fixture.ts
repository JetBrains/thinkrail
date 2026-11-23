import { stat } from "node:fs/promises";
import { CHILD_EVENT_PREFIX, EXPORT_RULES, type ExportCut, type TurnEvent } from "./core.ts";
import { type ByteRange, scanFile, sliceYielder } from "./lines.ts";
import { folderRewriter } from "./paths.ts";
import { isSecretLeaf, REDACTED, type Redactor, secretUnder } from "./redact.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";

interface Line {
	entry: Record<string, unknown>;
	range: ByteRange;
}

/** Where a cut landed: the turn it ends (or that holds the event) and the entry the session stops at. */
export interface FixtureCut {
	/** The turn the cut ends, or that holds the cut event; `null` before the first turn. */
	turn: TurnEvent | null;
	/** Whether the cut is the end of that turn (only then does a turn's workspace tree match it). */
	turnEnd: boolean;
	entryId: string;
}

export interface CutSession {
	cut: FixtureCut;
	/** The redacted `session.jsonl`, header first, one entry per line. */
	text: string;
	entries: number;
}

function entryIdOf(line: Line): string {
	return typeof line.entry.id === "string" ? line.entry.id : `@${line.range.offset}`;
}

/** The turn whose subtree holds an event: its nearest turn ancestor in the trace. */
function turnOf(trace: BuiltTrace, eventId: string): TurnEvent | null {
	const byId = new Map(trace.events.map((event) => [event.id, event]));
	let current = byId.get(eventId);
	while (current && current.kind !== "turn")
		current = current.parent ? byId.get(current.parent) : undefined;
	return current?.kind === "turn" ? current : null;
}

/**
 * Resolves a cut to the last entry the fixture keeps: the end of a turn is the entry the next turn's
 * start hangs from (the file's last entry after the last turn); an event is its own entry, or its tool
 * result. `null` when the cut names nothing in the trace.
 */
export function resolveCut(
	trace: BuiltTrace,
	cut: ExportCut,
	parentOf: (entryId: string) => string | null | undefined,
	leaf: string | null,
): FixtureCut | null {
	const turns = trace.events.filter((event): event is TurnEvent => event.kind === "turn");
	if (cut.kind === "turn") {
		const index = turns.findIndex((turn) => turn.n === cut.turn);
		const turn = turns[index];
		if (!turn) return null;
		const next = turns[index + 1];
		if (!next) return leaf ? { turn, turnEnd: true, entryId: leaf } : null;
		const start = trace.sources.get(next.id)?.entryId;
		const before = start === undefined ? undefined : parentOf(start);
		return before ? { turn, turnEnd: true, entryId: before } : null;
	}
	if (cut.eventId.startsWith(CHILD_EVENT_PREFIX)) return null;
	const source = trace.sources.get(cut.eventId);
	if (!source) return null;
	return {
		turn: turnOf(trace, cut.eventId),
		turnEnd: false,
		entryId: source.result?.entryId ?? source.entryId,
	};
}

/**
 * Every string and every key through `map`, every leaf at or under a secret-named key (`secretUnder`,
 * judged by the key as written) masked whole; other numbers, booleans and nulls unchanged.
 */
function mapStrings(value: unknown, map: (text: string) => string, secret = false): unknown {
	if (secret && isSecretLeaf(value)) return REDACTED;
	if (typeof value === "string") return map(value);
	if (Array.isArray(value)) return value.map((item): unknown => mapStrings(item, map, secret));
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const [name, item] of Object.entries(value))
			Object.defineProperty(out, map(name), {
				value: mapStrings(item, map, secretUnder(name, secret)),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		return out;
	}
	return value;
}

/**
 * The session cut for an e2e fixture: the header and the active branch from the root to the cut entry
 * (as pi would load the file at that point — abandoned branches are left out), every string redacted
 * with the session's folder replaced by `EXPORT_RULES.fixtureCwd` (the workflow harness rewrites the
 * recorded `cwd` at replay). A file whose entries have no ids (pi's first format) is cut by position.
 * Once `signal` aborts, it stops at its next yield and rejects with the reason.
 */
export async function cutSessionFile(
	trace: BuiltTrace,
	cut: ExportCut,
	redactor: Redactor,
	sliceMs = 8,
	signal?: AbortSignal,
): Promise<CutSession | null> {
	const size = (await stat(trace.file)).size;
	signal?.throwIfAborted();
	const lines: Line[] = [];
	const { tail } = await scanFile(
		trace.file,
		0,
		size,
		(entry, range) => {
			if (isRecord(entry)) lines.push({ entry, range });
		},
		sliceYielder(sliceMs, undefined, signal),
	);
	if (tail && isRecord(tail.entry)) lines.push({ entry: tail.entry, range: tail.range });
	const header = lines.find((line) => line.entry.type === "session");
	const body = lines.filter((line) => line !== header);
	const byId = new Map(body.map((line) => [entryIdOf(line), line]));
	const parentOf = (entryId: string) => {
		const parent = byId.get(entryId)?.entry.parentId;
		return typeof parent === "string" ? parent : parent === null ? null : undefined;
	};
	const last = body.at(-1);
	const resolved = resolveCut(trace, cut, parentOf, last ? entryIdOf(last) : null);
	const target = resolved ? byId.get(resolved.entryId) : undefined;
	if (!resolved || !target) return null;
	let kept: Line[];
	if (resolved.entryId.startsWith("@")) {
		kept = body.filter((line) => line.range.offset <= target.range.offset);
	} else {
		const chain = new Set<string>();
		for (
			let id: string | null | undefined = resolved.entryId;
			id && !chain.has(id);
			id = parentOf(id)
		)
			chain.add(id);
		kept = body.filter((line) => chain.has(entryIdOf(line)));
	}
	const cwd = trace.cwd ?? (typeof header?.entry.cwd === "string" ? header.entry.cwd : "");
	const toFixture = folderRewriter(cwd, EXPORT_RULES.fixtureCwd);
	const map = (text: string) => redactor.clean(toFixture(text));
	const out: string[] = [];
	const yielder = sliceYielder(sliceMs, undefined, signal);
	for (const line of [...(header ? [header] : []), ...kept]) {
		out.push(JSON.stringify(mapStrings(line.entry, map)));
		if (yielder.due()) await yielder.pause();
	}
	signal?.throwIfAborted();
	return { cut: resolved, text: `${out.join("\n")}\n`, entries: kept.length };
}

/** A workspace file of the snapshot: `*.md` is stored as `*.md.test` (the fixture layout masks markdown at rest). */
export function fixturePath(path: string): string {
	return path.endsWith(".md") ? `${path}.test` : path;
}

/** Where the harness's replay puts a fixture file back: `*.md.test` as `*.md`, anything else as is. */
function replayedPath(path: string): string {
	return path.endsWith(".md.test") ? path.slice(0, -".test".length) : path;
}

/**
 * The snapshot's files at their fixture paths (`at`), keeping only those a replay puts back where they
 * were: a file named `*.md.test` would come back as `*.md` (and may take a masked markdown file's
 * name), and a file whose fixture path is another one's folder cannot be written. Those are `omitted`
 * by their tree paths, sorted.
 */
export function placeSnapshot<T extends { path: string }>(
	files: readonly T[],
): { placed: { file: T; at: string }[]; omitted: string[] } {
	const omitted: string[] = [];
	const faithful: { file: T; at: string }[] = [];
	for (const file of files) {
		const at = fixturePath(file.path);
		if (replayedPath(at) === file.path) faithful.push({ file, at });
		else omitted.push(file.path);
	}
	const folders = new Set<string>();
	for (const { at } of faithful)
		for (let slash = at.indexOf("/"); slash >= 0; slash = at.indexOf("/", slash + 1))
			folders.add(at.slice(0, slash));
	const taken = new Set<string>();
	const placed: { file: T; at: string }[] = [];
	for (const entry of faithful) {
		if (folders.has(entry.at) || taken.has(entry.at)) omitted.push(entry.file.path);
		else {
			taken.add(entry.at);
			placed.push(entry);
		}
	}
	return { placed, omitted: omitted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

const DECODER = new TextDecoder("utf-8", { fatal: true });

/** The file's text when it is UTF-8 without NUL bytes, else `null` (binary). */
export function textOf(bytes: Uint8Array): string | null {
	if (bytes.includes(0)) return null;
	try {
		return DECODER.decode(bytes);
	} catch {
		return null;
	}
}

/** A fixture folder name: lower-case letters, digits and single dashes, at most `nameChars`. */
export function fixtureName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, EXPORT_RULES.nameChars)
		.replace(/-+$/g, "");
}
