import {
	LABEL_RULES,
	type LabelCount,
	type LabelsGetParams,
	type LabelsSetParams,
	type SessionLabels,
} from "./core.ts";
import type { JsonStore } from "./store.ts";
import { isRecord } from "./totals.ts";

export const LABELS_DOCUMENT = "labels.json";
const SESSION_ID_CHARS = 200;
const DOCUMENT_VERSION = 1;

interface StoredLabels {
	labels: string[];
	note?: string;
}

/** The labels document: `{ version, sessions: { [sessionId]: { labels, note? } } }`. */
export interface LabelsDocument {
	sessions: ReadonlyMap<string, StoredLabels>;
}

function validSessionId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= SESSION_ID_CHARS;
}

/** Trimmed, inner whitespace collapsed, control characters dropped; `null` when empty or too long. */
function normalizeLabel(value: string): string | null {
	const text = value
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > 0 && text.length <= LABEL_RULES.labelChars ? text : null;
}

/** Unique case-insensitively (the first spelling wins), sorted, at most `labelsPerSession`. */
function labelSet(values: readonly string[]): string[] | null {
	const seen = new Map<string, string>();
	for (const value of values) {
		const label = normalizeLabel(value);
		if (label === null) return null;
		const key = label.toLocaleLowerCase("en");
		if (!seen.has(key)) seen.set(key, label);
	}
	if (seen.size > LABEL_RULES.labelsPerSession) return null;
	return [...seen.values()].sort((a, b) => a.localeCompare(b, "en"));
}

function normalizeNote(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		.replace(/[^\P{Cc}\n\t]/gu, "")
		.trim();
}

export function parseLabelsGetParams(value: unknown): LabelsGetParams {
	const fail = () => new Error("Invalid labels.get params");
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) throw fail();
	const { sessionIds } = value;
	if (sessionIds === undefined) return {};
	if (
		!Array.isArray(sessionIds) ||
		sessionIds.length > LABEL_RULES.notesPerRequest ||
		!sessionIds.every(validSessionId)
	)
		throw fail();
	return { sessionIds: [...sessionIds] };
}

export function parseLabelsSetParams(value: unknown): LabelsSetParams {
	const fail = () => new Error("Invalid labels.set params");
	if (!isRecord(value)) throw fail();
	const { sessionId, labels, note } = value;
	if (!validSessionId(sessionId)) throw fail();
	if (
		!Array.isArray(labels) ||
		labels.length > LABEL_RULES.labelsPerSession * 2 ||
		!labels.every((label): label is string => typeof label === "string")
	)
		throw fail();
	const set = labelSet(labels);
	if (set === null) throw fail();
	if (note !== null && note !== undefined && typeof note !== "string") throw fail();
	const text = typeof note === "string" ? normalizeNote(note) : "";
	if (text.length > LABEL_RULES.noteChars) throw fail();
	return { sessionId, labels: set, note: text || null };
}

/** Reads what it can of a stored document; anything malformed is dropped, never fatal. */
export function parseLabelsDocument(value: unknown): LabelsDocument {
	const sessions = new Map<string, StoredLabels>();
	const raw = isRecord(value) && isRecord(value.sessions) ? value.sessions : {};
	for (const [sessionId, entry] of Object.entries(raw)) {
		if (!validSessionId(sessionId) || !isRecord(entry)) continue;
		const labels = Array.isArray(entry.labels)
			? labelSet(
					entry.labels
						.filter((label): label is string => typeof label === "string")
						.slice(0, LABEL_RULES.labelsPerSession),
				)
			: [];
		const note =
			typeof entry.note === "string"
				? normalizeNote(entry.note).slice(0, LABEL_RULES.noteChars)
				: "";
		if (!labels || (labels.length === 0 && !note)) continue;
		sessions.set(sessionId, note ? { labels, note } : { labels });
		if (sessions.size >= LABEL_RULES.sessions) break;
	}
	return { sessions };
}

function serialize(document: LabelsDocument): unknown {
	const sessions: Record<string, StoredLabels> = {};
	for (const sessionId of [...document.sessions.keys()].sort()) {
		const entry = document.sessions.get(sessionId);
		if (entry)
			Object.defineProperty(sessions, sessionId, {
				value: entry,
				enumerable: true,
				writable: true,
				configurable: true,
			});
	}
	return { version: DOCUMENT_VERSION, sessions };
}

function view(sessionId: string, entry: StoredLabels, withNote: boolean): SessionLabels {
	return {
		sessionId,
		labels: entry.labels,
		note: withNote ? (entry.note ?? null) : null,
		noted: entry.note !== undefined,
	};
}

/** Every label in use with its sessions, most sessions first, then by name. */
function labelVocabulary(document: LabelsDocument): LabelCount[] {
	const counts = new Map<string, LabelCount>();
	for (const entry of document.sessions.values())
		for (const label of entry.labels) {
			const key = label.toLocaleLowerCase("en");
			const count = counts.get(key);
			if (count) count.sessions += 1;
			else counts.set(key, { label, sessions: 1 });
		}
	return [...counts.values()].sort(
		(a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label, "en"),
	);
}

/** The labels of every labelled session (sorted by id) and the notes of the asked ones. */
export function labelsView(
	document: LabelsDocument,
	params: LabelsGetParams,
): { sessions: SessionLabels[]; vocabulary: LabelCount[] } {
	const asked = new Set(params.sessionIds ?? []);
	return {
		sessions: [...document.sessions.entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
			.map(([sessionId, entry]) => view(sessionId, entry, asked.has(sessionId))),
		vocabulary: labelVocabulary(document),
	};
}

export function readLabels(store: JsonStore): Promise<LabelsDocument> {
	return store.read(LABELS_DOCUMENT, parseLabelsDocument);
}

/** A session's labels by id; empty for an unlabelled session. */
export function labelLookup(document: LabelsDocument): (sessionId: string) => readonly string[] {
	return (sessionId) => document.sessions.get(sessionId)?.labels ?? [];
}

/**
 * Replaces one session's labels and note in the store (atomic, serialized by `JsonStore`). Refuses —
 * `full` — a new session past `LABEL_RULES.sessions`.
 */
export async function setSessionLabels(
	store: JsonStore,
	params: LabelsSetParams,
): Promise<
	{ ok: true; session: SessionLabels; vocabulary: LabelCount[] } | { ok: false; full: true }
> {
	let full = false;
	const written = await store.update(
		LABELS_DOCUMENT,
		parseLabelsDocument,
		(current) => {
			const sessions = new Map(current.sessions);
			const empty = params.labels.length === 0 && params.note === null;
			if (empty) sessions.delete(params.sessionId);
			else if (!sessions.has(params.sessionId) && sessions.size >= LABEL_RULES.sessions) {
				full = true;
				return current;
			} else
				sessions.set(
					params.sessionId,
					params.note === null
						? { labels: [...params.labels] }
						: { labels: [...params.labels], note: params.note },
				);
			return { sessions };
		},
		serialize,
	);
	if (full) return { ok: false, full: true };
	const entry = written.sessions.get(params.sessionId) ?? { labels: [] };
	return {
		ok: true,
		session: view(params.sessionId, entry, true),
		vocabulary: labelVocabulary(written),
	};
}
