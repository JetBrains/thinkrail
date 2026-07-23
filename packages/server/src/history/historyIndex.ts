import { readFileSync, statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { HistorySearchResult, MessageHit, PromptHit } from "@thinkrail/contracts";
import { extractEntries, type HistoryEntry } from "./extract";

interface SessionRecord {
	sessionId: string;
	cwd: string;
	title?: string;
	path: string;
	mtimeMs: number;
	entries: HistoryEntry[];
}

const REVALIDATE_MS = 2000;
const BATCH = 20;
/** Cold (first-ever) build budget: block `search()` this long, then return whatever's parsed so far
 * with `indexing: true`. Warm revalidations (only new/mtime-changed files) are always awaited in full —
 * they're bounded by the mtime diff, so search results are only ever as stale as the last file write. */
const COLD_BUILD_BUDGET_MS = 150;
/** Default snippet half-window, in chars, on either side of the matched term. */
const SNIPPET_RADIUS = 60;

/** `query.toLowerCase().split(/\s+/)` AND-matching: every term must be a case-insensitive substring of
 * `text`. An empty term (from an empty/whitespace-only query) is vacuously true for any text — this is
 * what makes "empty query matches everything" fall out of the same code path as a real search. */
export function matchesTerms(text: string, terms: string[]): boolean {
	const lower = text.toLowerCase();
	return terms.every((term) => lower.includes(term.toLowerCase()));
}

/** A window of `text` around the first case-insensitive occurrence of `term`, ellipsized on whichever
 * edge got truncated. Falls back to a plain prefix if `term` isn't found (callers only snippet entries
 * that already passed `matchesTerms`, so this is defensive, not a normal path). Pure. */
export function makeSnippet(text: string, term: string, radius = SNIPPET_RADIUS): string {
	const idx = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
	if (idx === -1) return text.slice(0, radius * 2);
	const start = Math.max(0, idx - radius);
	const end = Math.min(text.length, idx + term.length + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

export class HistoryIndex {
	private records = new Map<string, SessionRecord>(); // keyed by file path
	private building: Promise<void> | null = null;
	private built = false;
	private lastCheck = 0;

	constructor(private sessionDir?: string) {}

	private async listInfos() {
		return this.sessionDir ? SessionManager.listAll(this.sessionDir) : SessionManager.listAll();
	}

	private loadRecord(info: { path: string; id: string; cwd: string; name?: string }): void {
		try {
			const mtimeMs = statSync(info.path).mtimeMs;
			const entries = extractEntries(readFileSync(info.path, "utf8"));
			this.records.set(info.path, {
				sessionId: info.id,
				cwd: info.cwd,
				path: info.path,
				mtimeMs,
				entries,
				...(info.name ? { title: info.name } : {}),
			});
		} catch {
			this.records.delete(info.path); // vanished/unreadable mid-walk — drop it
		}
	}

	/** Cold build / revalidation. Batched so it never starves the event loop live sessions share. */
	private async refresh(): Promise<void> {
		const infos = await this.listInfos();
		const seen = new Set<string>();
		let inBatch = 0;
		for (const info of infos) {
			seen.add(info.path);
			const rec = this.records.get(info.path);
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(info.path).mtimeMs;
			} catch {
				continue;
			}
			if (rec && rec.mtimeMs === mtimeMs) continue;
			this.loadRecord(info);
			if (++inBatch % BATCH === 0) await new Promise((r) => setImmediate(r));
		}
		for (const path of this.records.keys()) if (!seen.has(path)) this.records.delete(path);
		this.built = true;
	}

	private ensureFresh(): void {
		const now = Date.now();
		if (!this.building && (!this.built || now - this.lastCheck > REVALIDATE_MS)) {
			this.lastCheck = now;
			this.building = this.refresh().finally(() => {
				this.building = null;
			});
		}
	}

	/**
	 * Search the index. Blocks on a cold (first-ever) build up to `COLD_BUILD_BUDGET_MS`, then returns
	 * partial results with `indexing: true` if the build is still running. A warm revalidation (mtime
	 * throttled to `REVALIDATE_MS`) is always awaited fully — it only touches new/changed files, so it's
	 * bounded and search results should never lag behind an on-disk write by more than the throttle.
	 */
	async search(input: {
		query: string;
		limit?: number;
		filter: (cwd: string, sessionId: string) => boolean;
		labels: (cwd: string) => { workspaceId?: string; projectId?: string };
	}): Promise<HistorySearchResult> {
		const wasCold = !this.built;
		this.ensureFresh();
		if (this.building) {
			if (wasCold) await Promise.race([this.building, Bun.sleep(COLD_BUILD_BUDGET_MS)]);
			else await this.building;
		}
		const indexing = !this.built;

		const limit = input.limit ?? 50;
		const terms = input.query.toLowerCase().split(/\s+/);
		const primaryTerm = terms.find((t) => t.length > 0) ?? "";
		const emptyQuery = input.query.trim().length === 0;

		const promptCandidates: PromptHit[] = [];
		const messageCandidates: MessageHit[] = [];

		for (const rec of this.records.values()) {
			if (!input.filter(rec.cwd, rec.sessionId)) continue;
			const scope = input.labels(rec.cwd);
			for (const entry of rec.entries) {
				if (!matchesTerms(entry.text, terms)) continue;
				// every prompt hit carries its own jump anchor (the same two fields a MessageHit
				// always had) — populated from this entry, so dedup (below) naturally keeps the
				// kept-newest occurrence's anchor along with its text.
				const hit: PromptHit = {
					text: entry.text,
					timestamp: entry.timestamp,
					sessionId: rec.sessionId,
					cwd: rec.cwd,
					messageIndex: entry.messageIndex,
					anchorText: entry.text.slice(0, 120),
					...(rec.title ? { sessionTitle: rec.title } : {}),
					...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
					...(scope.projectId ? { projectId: scope.projectId } : {}),
				};
				if (entry.role === "user") promptCandidates.push(hit);
				// messages section is assistant-only — a user-role hit is always a textual
				// duplicate of its own prompt entry above, so it would add no text, only a location;
				// that location now lives on the prompt hit's messageIndex/anchorText instead.
				if (!emptyQuery && entry.role === "assistant") {
					messageCandidates.push({
						...hit,
						role: entry.role,
						snippet: makeSnippet(entry.text, primaryTerm),
						messageIndex: entry.messageIndex,
						anchorText: entry.text.slice(0, 120),
					});
				}
			}
		}

		promptCandidates.sort((a, b) => b.timestamp - a.timestamp);
		messageCandidates.sort((a, b) => b.timestamp - a.timestamp);

		// Dedup by normalized text, keeping the newest: since candidates are already sorted by
		// recency desc, keeping the first occurrence of each key keeps the newest one.
		const seenKeys = new Set<string>();
		const dedupedPrompts: PromptHit[] = [];
		for (const p of promptCandidates) {
			const key = p.text.trim().replace(/\s+/g, " ");
			if (seenKeys.has(key)) continue;
			seenKeys.add(key);
			dedupedPrompts.push(p);
		}

		return {
			prompts: dedupedPrompts.slice(0, limit),
			messages: messageCandidates.slice(0, limit),
			promptTotal: dedupedPrompts.length,
			messageTotal: messageCandidates.length,
			indexing,
		};
	}
}

let instance: HistoryIndex | null = null;

/** Lazy process-wide singleton — one in-memory index shared by every `history.search` call. */
export function getHistoryIndex(): HistoryIndex {
	if (!instance) instance = new HistoryIndex();
	return instance;
}
