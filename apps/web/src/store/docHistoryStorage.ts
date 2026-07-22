import type { DocHistoryEntry } from "./appStore";

/**
 * localStorage persistence for the per-workspace opened-documents History (view state only — no wire /
 * server / domain state). Mirrors the `utils/theme` localStorage precedent, but kept inside the store
 * module since only the store reads/writes it. Fails soft: a missing / malformed / unavailable store
 * degrades to an empty history rather than throwing.
 */
const KEY = "thinkrail:docHistory";
export const DOC_HISTORY_LIMIT = 10;

type DocHistoryMap = Record<string, DocHistoryEntry[]>;

function isEntry(v: unknown): v is DocHistoryEntry {
	if (typeof v !== "object" || v === null) return false;
	const e = v as Record<string, unknown>;
	return (
		(e.kind === "file" || e.kind === "diff") &&
		typeof e.path === "string" &&
		typeof e.name === "string"
	);
}

export function readDocHistory(): DocHistoryMap {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const out: DocHistoryMap = {};
		for (const [ws, list] of Object.entries(parsed as Record<string, unknown>)) {
			if (Array.isArray(list)) out[ws] = list.filter(isEntry).slice(0, DOC_HISTORY_LIMIT);
		}
		return out;
	} catch {
		return {};
	}
}

export function writeDocHistory(map: DocHistoryMap): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// Storage unavailable / quota — history is best-effort view state, so a write failure is silent.
	}
}
