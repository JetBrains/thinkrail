import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { HistorySearchResult, MessageHit, PromptHit } from "@thinkrail/contracts";
import { MAX_HISTORY_LIMIT, MAX_HISTORY_QUERY_LENGTH } from "@thinkrail/contracts";
import { extractSession, type HistoryEntry } from "./extract";

interface SessionRecord {
	sessionId: string;
	cwd: string;
	title?: string;
	path: string;
	mtimeMs: number;
	/** File size — paired with `mtimeMs` for change detection so an append that lands in the same coarse
	 * mtime tick as the last read (the file always grows) still triggers a reload. */
	size: number;
	entries: HistoryEntry[];
}

const REVALIDATE_MS = 2000;
/** Cold (first-ever) build budget: block `search()` this long, then return whatever's parsed so far
 * with `indexing: true`. A warm revalidation is NOT awaited — an unchanged corpus revalidates for just a
 * `readdir` walk + one `stat` per file, but a bulk change (the first refresh after a restart, a git
 * checkout touching many sessions) still re-parses every changed file, so blocking a search on it would
 * tax exactly the queries that hit the worst case; instead it runs in the background and results are at
 * most one revalidation cycle stale (the same tolerance the cold path's `indexing` flag already relies
 * on). */
const COLD_BUILD_BUDGET_MS = 150;
/** Default snippet half-window, in chars, on either side of the matched term. */
const SNIPPET_RADIUS = 60;

/** Clamp a client-supplied `limit` to a finite, non-negative integer within the protocol cap — so a
 * missing/negative/oversized value can neither defeat the cap nor hit `Array.slice`'s negative-index
 * semantics (`slice(0, -1)` would silently drop the last item). Applied at both the `history.search`
 * handler boundary and inside `search()` (defense in depth). */
export function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return 50;
	return Math.max(0, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
}

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

/** The `.jsonl` files directly inside `dir` (non-recursive — pi's own rule for a flat session dir);
 * a missing/unreadable dir is an empty list, matching pi's tolerance for a vanished dir mid-walk. */
async function listJsonl(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
	} catch {
		return [];
	}
}

export class HistoryIndex {
	private records = new Map<string, SessionRecord>(); // keyed by file path
	private building: Promise<void> | null = null;
	private built = false;
	private lastCheck = 0;

	constructor(private sessionDir?: string) {}

	/**
	 * Enumerate candidate session files WITHOUT reading their contents — never via
	 * `SessionManager.listAll()`, which reads and JSON-parses every session in full just to list it (see
	 * SPEC.md). Mirrors pi's pinned discovery rules: a custom `sessionDir` is a flat, non-recursive dir of
	 * `.jsonl` files; the default root (`<agentDir>/sessions` — agent dir resolved per call via pi's
	 * `getAgentDir()`, which reads `PI_CODING_AGENT_DIR` live) holds one level of per-cwd subdirectories.
	 * A missing dir is an empty corpus, not an error.
	 */
	private async listFiles(): Promise<string[]> {
		if (this.sessionDir) return listJsonl(this.sessionDir);
		const root = join(getAgentDir(), "sessions");
		let subdirs: string[] = [];
		try {
			subdirs = (await readdir(root, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(root, entry.name));
		} catch {
			return [];
		}
		const files: string[] = [];
		for (const dir of subdirs) files.push(...(await listJsonl(dir)));
		return files;
	}

	/** One async read + parse; identity (id/cwd/title) comes from the same parse (`extractSession`).
	 * `mtimeMs`/`size` are the values statted BEFORE the read — if an append lands between the stat and
	 * the read, the stored pair is older than the stored content, so the next cycle just re-reads (the
	 * safe direction; recording a post-read stat could mask an append that slipped in between). */
	private async loadRecord(path: string, mtimeMs: number, size: number): Promise<void> {
		try {
			const session = extractSession(await readFile(path, "utf8"));
			if (!session) {
				this.records.delete(path); // a stray non-session .jsonl — pi would skip it too
				return;
			}
			this.records.set(path, {
				sessionId: session.id,
				cwd: session.cwd,
				path,
				mtimeMs,
				size,
				entries: session.entries,
				...(session.title ? { title: session.title } : {}),
			});
		} catch {
			this.records.delete(path); // vanished/unreadable mid-walk — drop it
		}
	}

	/** Cold build / revalidation. Only new/changed files are read and parsed; every file boundary has an
	 * `await` (stat/read), so the walk never starves the event loop live sessions share — the longest
	 * uninterrupted stretch is one file's parse. */
	private async refresh(): Promise<void> {
		const files = await this.listFiles();
		const seen = new Set<string>(files);
		for (const path of files) {
			let mtimeMs = 0;
			let size = 0;
			try {
				({ mtimeMs, size } = await stat(path));
			} catch {
				continue;
			}
			const rec = this.records.get(path);
			// Skip only when BOTH mtime and size are unchanged — an append can land in the same coarse
			// mtime tick as the last read, but it always changes the size.
			if (rec && rec.mtimeMs === mtimeMs && rec.size === size) continue;
			await this.loadRecord(path, mtimeMs, size);
		}
		for (const path of this.records.keys()) if (!seen.has(path)) this.records.delete(path);
		this.built = true;
	}

	private ensureFresh(): void {
		const now = Date.now();
		if (!this.building && (!this.built || now - this.lastCheck > REVALIDATE_MS)) {
			this.lastCheck = now;
			// A warm revalidation isn't awaited by `search()`, so swallow its errors here — an unhandled
			// rejection would otherwise be able to take down the in-process host. A failed refresh just
			// leaves the current index in place; the next cycle retries. (A cold build's error is caught the
			// same way, leaving `built` false so `indexing: true` keeps being reported until it succeeds.)
			this.building = this.refresh()
				.catch(() => {})
				.finally(() => {
					this.building = null;
				});
		}
	}

	/**
	 * Search the index. Blocks on a cold (first-ever) build up to `COLD_BUILD_BUDGET_MS`, then returns
	 * partial results with `indexing: true` if the build is still running. A warm revalidation (mtime
	 * throttled to `REVALIDATE_MS`) runs in the background and is **not** awaited — its worst case (a bulk
	 * change re-parsing many files) is exactly when blocking would hurt most; results are instead at most
	 * one revalidation cycle stale.
	 */
	async search(input: {
		query: string;
		limit?: number;
		filter: (cwd: string, sessionId: string) => boolean;
		labels: (cwd: string) => { workspaceId?: string; projectId?: string };
	}): Promise<HistorySearchResult> {
		const wasCold = !this.built;
		this.ensureFresh();
		// Only a cold build blocks the search (up to the budget); a warm revalidation runs in the
		// background — see `COLD_BUILD_BUDGET_MS`.
		if (this.building && wasCold) {
			await Promise.race([this.building, Bun.sleep(COLD_BUILD_BUDGET_MS)]);
		}
		// `indexing` is reported while ANY build is in flight — the first cold build OR a background warm
		// revalidation — not just the cold one. A warm revalidation returns the current (possibly
		// one-cycle-stale) records immediately without blocking, but flagging `indexing` keeps the client's
		// retry loop polling until `this.building` settles, so a just-written session still surfaces without
		// the search ever having to wait on the full-corpus re-parse (read-your-writes without blocking).
		const indexing = !this.built || this.building !== null;

		const limit = clampLimit(input.limit);
		// Cap the query length as defense against pathological matching work; truncation can't turn a
		// non-empty query empty, so the "empty query matches everything" branch is unaffected.
		const query = input.query.slice(0, MAX_HISTORY_QUERY_LENGTH);
		const terms = query.toLowerCase().split(/\s+/);
		const primaryTerm = terms.find((t) => t.length > 0) ?? "";
		const emptyQuery = query.trim().length === 0;

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
