const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 14;
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
const ADAPTIVE_DECAY_PER_DAY = 0.975;
const ADAPTIVE_MIN_COUNT = 0.1;
const MAX_ITEMS = 500;
const MAX_QUERIES = 500;
const MAX_PICKS_PER_QUERY = 32;
const MAX_QUERY_LENGTH = 40;
const MAX_ID_LENGTH = 200;
export const MAX_LEARNING_BYTES = 200_000;

interface AdaptiveEntry {
	readonly count: number;
	readonly day: number;
}

export interface LearningSnapshot {
	readonly version: 1;
	readonly frecency: Readonly<Record<string, number>>;
	readonly adaptive: Readonly<Record<string, Readonly<Record<string, AdaptiveEntry>>>>;
}

export const EMPTY_LEARNING: LearningSnapshot = { version: 1, frecency: {}, adaptive: {} };

function day(nowMs: number): number {
	return nowMs / DAY_MS;
}

function normalizeQuery(query: string): string {
	return query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

export function frecencyScore(snapshot: LearningSnapshot, id: string, nowMs: number): number {
	const stored = snapshot.frecency[id];
	return stored === undefined ? 0 : Math.exp(LAMBDA * (stored - day(nowMs)));
}

export function adaptiveCounts(
	snapshot: LearningSnapshot,
	query: string,
	nowMs: number,
): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	const normalized = normalizeQuery(query);
	if (!normalized) return counts;
	const today = day(nowMs);
	for (const [stored, picks] of Object.entries(snapshot.adaptive)) {
		if (!stored.startsWith(normalized)) continue;
		for (const [id, entry] of Object.entries(picks)) {
			const decayed = entry.count * ADAPTIVE_DECAY_PER_DAY ** Math.max(0, today - entry.day);
			const count = stored === normalized ? decayed * 2 : decayed;
			if (count > (counts.get(id) ?? 0)) counts.set(id, count);
		}
	}
	return counts;
}

function prune<T>(record: Record<string, T>, limit: number, score: (value: T) => number) {
	const entries = Object.entries(record);
	if (entries.length <= limit) return record;
	entries.sort((a, b) => score(b[1]) - score(a[1]));
	return Object.fromEntries(entries.slice(0, limit));
}

export function recordPick(
	snapshot: LearningSnapshot,
	query: string,
	id: string,
	nowMs: number,
): LearningSnapshot {
	if (!id || id.length > MAX_ID_LENGTH) return snapshot;
	const today = day(nowMs);
	const current = frecencyScore(snapshot, id, nowMs);
	const frecency = prune(
		{ ...snapshot.frecency, [id]: today + Math.log(current + 1) / LAMBDA },
		MAX_ITEMS,
		(value) => value,
	);
	const normalized = normalizeQuery(query);
	let adaptive = snapshot.adaptive;
	if (normalized) {
		const picks = { ...(adaptive[normalized] ?? {}) };
		const previous = picks[id];
		const decayed = previous
			? previous.count * ADAPTIVE_DECAY_PER_DAY ** Math.max(0, today - previous.day)
			: 0;
		picks[id] = { count: decayed * 0.9 + 1, day: today };
		const kept = prune(picks, MAX_PICKS_PER_QUERY, (entry) => entry.day);
		adaptive = prune({ ...adaptive, [normalized]: kept }, MAX_QUERIES, (value) =>
			Math.max(...Object.values(value).map((entry) => entry.day)),
		);
	}
	return { version: 1, frecency, adaptive };
}

function isAdaptiveEntry(value: unknown): value is AdaptiveEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "count") === "number" &&
		typeof Reflect.get(value, "day") === "number"
	);
}

export function parseLearning(raw: string | null, nowMs: number): LearningSnapshot {
	if (!raw) return EMPTY_LEARNING;
	try {
		const value = JSON.parse(raw) as unknown;
		if (typeof value !== "object" || value === null || Reflect.get(value, "version") !== 1) {
			return EMPTY_LEARNING;
		}
		const frecency: Record<string, number> = {};
		for (const [id, stored] of Object.entries(Reflect.get(value, "frecency") ?? {})) {
			if (typeof stored === "number" && Number.isFinite(stored)) frecency[id] = stored;
		}
		const adaptive: Record<string, Record<string, AdaptiveEntry>> = {};
		const today = day(nowMs);
		for (const [query, picks] of Object.entries(Reflect.get(value, "adaptive") ?? {})) {
			const kept: Record<string, AdaptiveEntry> = {};
			for (const [id, entry] of Object.entries(picks ?? {})) {
				if (!isAdaptiveEntry(entry)) continue;
				const decayed = entry.count * ADAPTIVE_DECAY_PER_DAY ** Math.max(0, today - entry.day);
				if (decayed >= ADAPTIVE_MIN_COUNT) kept[id] = entry;
			}
			if (Object.keys(kept).length > 0) adaptive[query] = kept;
		}
		return { version: 1, frecency, adaptive };
	} catch {
		return EMPTY_LEARNING;
	}
}

const utf8 = new TextEncoder();

export function serializeLearning(snapshot: LearningSnapshot): string {
	let current = snapshot;
	let text = JSON.stringify(current);
	while (utf8.encode(text).length > MAX_LEARNING_BYTES) {
		const itemLimit = Math.floor(Object.keys(current.frecency).length / 2);
		const queryLimit = Math.floor(Object.keys(current.adaptive).length / 2);
		current = {
			version: 1,
			frecency: prune({ ...current.frecency }, itemLimit, (value) => value),
			adaptive: prune({ ...current.adaptive }, queryLimit, (value) =>
				Math.max(...Object.values(value).map((entry) => entry.day)),
			),
		};
		text = JSON.stringify(current);
	}
	return text;
}
