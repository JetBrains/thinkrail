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
	size: number;
	entries: HistoryEntry[];
}

const REVALIDATE_MS = 2000;
const COLD_BUILD_BUDGET_MS = 150;
const SNIPPET_RADIUS = 60;

export function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return 50;
	return Math.max(0, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
}

export function matchesTerms(text: string, terms: string[]): boolean {
	const lower = text.toLowerCase();
	return terms.every((term) => lower.includes(term.toLowerCase()));
}

export function makeSnippet(text: string, term: string, radius = SNIPPET_RADIUS): string {
	const idx = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
	if (idx === -1) return text.slice(0, radius * 2);
	const start = Math.max(0, idx - radius);
	const end = Math.min(text.length, idx + term.length + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

async function listJsonl(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
	} catch {
		return [];
	}
}

export class HistoryIndex {
	private records = new Map<string, SessionRecord>();
	private building: Promise<void> | null = null;
	private built = false;
	private lastCheck = 0;

	constructor(private sessionDir?: string) {}

	private async listFiles(): Promise<string[]> {
		if (this.sessionDir) return listJsonl(this.sessionDir);
		const root = join(getAgentDir(), "sessions");
		let subdirs: string[] = [];
		try {
			subdirs = (await readdir(root, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
				.map((entry) => join(root, entry.name));
		} catch {
			return [];
		}
		const files: string[] = [];
		for (const dir of subdirs) files.push(...(await listJsonl(dir)));
		return files;
	}

	private async loadRecord(path: string, mtimeMs: number, size: number): Promise<void> {
		try {
			const session = extractSession(await readFile(path, "utf8"));
			if (!session) {
				this.records.delete(path);
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
			this.records.delete(path);
		}
	}

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
			this.building = this.refresh()
				.catch(() => {})
				.finally(() => {
					this.building = null;
				});
		}
	}

	async search(input: {
		query: string;
		limit?: number;
		filter: (cwd: string, sessionId: string) => boolean;
		labels: (cwd: string) => { workspaceId?: string; projectId?: string };
	}): Promise<HistorySearchResult> {
		const wasCold = !this.built;
		this.ensureFresh();
		if (this.building && wasCold) {
			await Promise.race([this.building, Bun.sleep(COLD_BUILD_BUDGET_MS)]);
		}
		const indexing = !this.built || this.building !== null;

		const limit = clampLimit(input.limit);
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

export function getHistoryIndex(): HistoryIndex {
	if (!instance) instance = new HistoryIndex();
	return instance;
}
