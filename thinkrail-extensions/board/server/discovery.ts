import type { ExtensionHostProject } from "@thinkrail/extension-api/server";
import {
	type Evidence,
	type EvidenceKind,
	type Horizon,
	type Idea,
	type IdeaScore,
	type IdeaStatus,
	SCORE_MAX,
	SCORE_MIN,
	type WatchEntry,
	type WatchSnapshot,
} from "./model";
import type { BoardStore, IdeasFile, WatchlistFile } from "./store";

export const REF_MAX = 2_000;
export const QUOTE_MAX = 2_000;
export const REASON_MAX = 1_000;
export const REASONS_MAX = 20;
export const URLS_MAX = 20;
export const EVIDENCE_MAX = 200;
export const SNAPSHOT_MAX = 50_000;

/** What discovery needs of its board: the store, the open projects and the change signal. */
export interface DiscoveryHost {
	store: BoardStore;
	now(): number;
	/** The open repository project; throws for any other. */
	project(projectId: string): ExtensionHostProject;
	changed(projectId: string): void;
}

export interface IdeaInput {
	title: string;
	pitch?: string;
}

export interface EvidenceInput {
	kind: EvidenceKind;
	ref: string;
	quote?: string;
	/** The workspace an artifact's path is relative to. */
	workspaceId?: string;
}

export interface ScoreInput {
	score: number;
	/** Absent: the score's current reasons stay. */
	reasons?: string[];
}

export interface IdeaPatch {
	title?: string;
	pitch?: string;
	/** A human's score, no longer a suggestion; `null` clears it. */
	value?: ScoreInput | null;
	effort?: ScoreInput | null;
	/** `true` dismisses the idea, `false` brings it back. */
	dismissed?: boolean;
}

/** The agent's analysis: suggested scores with their reasons and a horizon. */
export interface SuggestedScores {
	value?: { score: number; reasons: string[] };
	effort?: { score: number; reasons: string[] };
	horizon?: { horizon: Horizon; reason: string };
}

export interface WatchInput {
	name: string;
	urls?: string[];
	notes?: string;
}

export type WatchPatch = Partial<WatchInput>;

/** An idea as `discovery.get` answers it: with the initiative it was promoted to, while that exists. */
export type IdeaView = Idea & { initiative?: { id: string; title: string } };

export interface DiscoveryView {
	projectId: string;
	projectName: string;
	ideas: IdeaView[];
	watchlist: WatchEntry[];
}

const SCORED = ["value", "effort"] as const;

function checkScore(score: number): number {
	if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX)
		throw new Error(`A score is a whole number from ${SCORE_MIN} to ${SCORE_MAX}.`);
	return score;
}

function checkReasons(reasons: readonly string[]): string[] {
	const kept = reasons.map((reason) => reason.trim()).filter(Boolean);
	if (kept.length > REASONS_MAX) throw new Error(`Give at most ${REASONS_MAX} reasons.`);
	if (kept.some((reason) => reason.length > REASON_MAX))
		throw new Error(`A reason is at most ${REASON_MAX} characters.`);
	return kept;
}

/** A URL evidence's http(s) URL; an artifact's worktree-relative path; a note's text. */
function checkRef(kind: EvidenceKind, ref: string): string {
	const trimmed = ref.trim();
	if (!trimmed) throw new Error("Pass a non-empty ref.");
	if (trimmed.length > REF_MAX) throw new Error(`ref is longer than ${REF_MAX} characters.`);
	if (kind === "url") {
		let url: URL | null = null;
		try {
			url = new URL(trimmed);
		} catch {}
		if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
			throw new Error("A url evidence needs an http(s) URL.");
		return url.href;
	}
	if (kind === "artifact") {
		const path = trimmed.replaceAll("\\", "/");
		if (
			path.startsWith("/") ||
			/^[A-Za-z]:/.test(path) ||
			path.includes("\0") ||
			path.split("/").some((segment) => segment === "..")
		)
			throw new Error("An artifact evidence needs its path relative to the workspace.");
		return path.replace(/^\.\//, "");
	}
	return trimmed;
}

/** An idea's status once it is neither promoted nor dismissed: analyzed when it has a score. */
function openStatus(idea: Pick<Idea, "value" | "effort">): IdeaStatus {
	return idea.value || idea.effort ? "analyzed" : "new";
}

/** Discovery per board: ideas with their evidence and scores, and the competitor watchlist. */
export class Discovery {
	private readonly host: DiscoveryHost;

	constructor(host: DiscoveryHost) {
		this.host = host;
	}

	private get store(): BoardStore {
		return this.host.store;
	}

	private file(projectId: string, id: string): { file: IdeasFile; idea: Idea } {
		this.host.project(projectId);
		const file = this.store.ideas(projectId);
		const idea = file.ideas.find((candidate) => candidate.id === id.trim().toUpperCase());
		if (!idea) throw new Error(`No idea ${id} on this board.`);
		return { file, idea };
	}

	private watchFile(projectId: string, id: string): { file: WatchlistFile; entry: WatchEntry } {
		this.host.project(projectId);
		const file = this.store.watchlist(projectId);
		const entry = file.entries.find((candidate) => candidate.id === id.trim().toUpperCase());
		if (!entry) throw new Error(`No watchlist entry ${id} on this board.`);
		return { file, entry };
	}

	private saveIdea(projectId: string, file: IdeasFile, next: Idea, extra: Partial<IdeasFile> = {}) {
		const exists = file.ideas.some((candidate) => candidate.id === next.id);
		this.store.saveIdeas(projectId, {
			...file,
			...extra,
			ideas: exists
				? file.ideas.map((candidate) => (candidate.id === next.id ? next : candidate))
				: [...file.ideas, next],
		});
		this.host.changed(projectId);
	}

	private saveEntry(projectId: string, file: WatchlistFile, next: WatchEntry, nextNumber?: number) {
		const exists = file.entries.some((candidate) => candidate.id === next.id);
		this.store.saveWatchlist(projectId, {
			...file,
			...(nextNumber !== undefined ? { nextNumber } : {}),
			entries: exists
				? file.entries.map((candidate) => (candidate.id === next.id ? next : candidate))
				: [...file.entries, next],
		});
		this.host.changed(projectId);
	}

	get(projectId: string): DiscoveryView {
		const project = this.host.project(projectId);
		const initiatives = new Map(
			this.store
				.initiatives(projectId)
				.initiatives.map((initiative) => [initiative.id, initiative]),
		);
		return {
			projectId,
			projectName: project.name,
			ideas: this.store.ideas(projectId).ideas.map((idea): IdeaView => {
				const initiative = idea.initiativeId ? initiatives.get(idea.initiativeId) : undefined;
				return initiative
					? { ...idea, initiative: { id: initiative.id, title: initiative.title } }
					: idea;
			}),
			watchlist: this.store.watchlist(projectId).entries,
		};
	}

	idea(projectId: string, id: string): Idea {
		return this.file(projectId, id).idea;
	}

	watchEntry(projectId: string, id: string): WatchEntry {
		return this.watchFile(projectId, id).entry;
	}

	createIdea(projectId: string, input: IdeaInput): Idea {
		this.host.project(projectId);
		const file = this.store.ideas(projectId);
		const at = this.host.now();
		const idea: Idea = {
			id: `D-${file.nextNumber}`,
			title: input.title,
			pitch: input.pitch ?? "",
			evidence: [],
			status: "new",
			createdAt: at,
			updatedAt: at,
		};
		this.saveIdea(projectId, file, idea, { nextNumber: file.nextNumber + 1 });
		return idea;
	}

	/** A human's edit: a score set here is no longer a suggestion. */
	updateIdea(projectId: string, id: string, patch: IdeaPatch): Idea {
		const { file, idea } = this.file(projectId, id);
		const next: Idea = { ...idea, updatedAt: this.host.now() };
		if (patch.title !== undefined) next.title = patch.title;
		if (patch.pitch !== undefined) next.pitch = patch.pitch;
		for (const key of SCORED) {
			const score = patch[key];
			if (score === null) delete next[key];
			else if (score)
				next[key] = {
					score: checkScore(score.score),
					reasons: score.reasons ? checkReasons(score.reasons) : (idea[key]?.reasons ?? []),
					suggested: false,
				};
		}
		if (patch.dismissed === true) {
			if (idea.status === "promoted")
				throw new Error(`${idea.id} is promoted to ${idea.initiativeId}; it can't be dismissed.`);
			next.status = "dismissed";
		} else if (patch.dismissed === false && idea.status === "dismissed")
			next.status = openStatus(next);
		else if (next.status === "new" || next.status === "analyzed") next.status = openStatus(next);
		this.saveIdea(projectId, file, next);
		return next;
	}

	deleteIdea(projectId: string, id: string): { deleted: string } {
		const { file, idea } = this.file(projectId, id);
		this.store.saveIdeas(projectId, {
			...file,
			ideas: file.ideas.filter((candidate) => candidate.id !== idea.id),
		});
		this.host.changed(projectId);
		return { deleted: idea.id };
	}

	addEvidence(
		projectId: string,
		id: string,
		input: EvidenceInput,
		by: "human" | "agent",
	): { idea: Idea; evidence: Evidence } {
		const { file, idea } = this.file(projectId, id);
		if (idea.evidence.length >= EVIDENCE_MAX)
			throw new Error(`${idea.id} already has ${EVIDENCE_MAX} pieces of evidence.`);
		const quote = input.quote?.trim();
		if (quote && quote.length > QUOTE_MAX)
			throw new Error(`quote is longer than ${QUOTE_MAX} characters.`);
		const at = this.host.now();
		const evidence: Evidence = {
			id: `E-${file.nextEvidenceNumber}`,
			kind: input.kind,
			ref: checkRef(input.kind, input.ref),
			...(quote ? { quote } : {}),
			...(input.kind === "artifact" && input.workspaceId ? { workspaceId: input.workspaceId } : {}),
			addedBy: by,
			at,
		};
		const next: Idea = { ...idea, evidence: [...idea.evidence, evidence], updatedAt: at };
		this.saveIdea(projectId, file, next, { nextEvidenceNumber: file.nextEvidenceNumber + 1 });
		return { idea: next, evidence };
	}

	removeEvidence(projectId: string, id: string, evidenceId: string): Idea {
		const { file, idea } = this.file(projectId, id);
		const wanted = evidenceId.trim().toUpperCase();
		if (!idea.evidence.some((evidence) => evidence.id === wanted))
			throw new Error(`${idea.id} has no evidence ${evidenceId}.`);
		const next: Idea = {
			...idea,
			evidence: idea.evidence.filter((evidence) => evidence.id !== wanted),
			updatedAt: this.host.now(),
		};
		this.saveIdea(projectId, file, next);
		return next;
	}

	/**
	 * The agent's suggested scores and horizon. A score a human set or confirmed is never overwritten:
	 * it is kept and named in `kept`.
	 */
	suggestScores(
		projectId: string,
		id: string,
		scores: SuggestedScores,
	): { idea: Idea; kept: ("value" | "effort")[] } {
		const { file, idea } = this.file(projectId, id);
		if (!scores.value && !scores.effort && !scores.horizon)
			throw new Error("Pass a value, an effort or a horizon.");
		const next: Idea = { ...idea, updatedAt: this.host.now() };
		const kept: ("value" | "effort")[] = [];
		for (const key of SCORED) {
			const suggestion = scores[key];
			if (!suggestion) continue;
			const score: IdeaScore = {
				score: checkScore(suggestion.score),
				reasons: checkReasons(suggestion.reasons),
				suggested: true,
			};
			if (score.reasons.length === 0) throw new Error(`Give the reasons for the ${key} score.`);
			const current = idea[key];
			if (current && !current.suggested) kept.push(key);
			else next[key] = score;
		}
		if (scores.horizon) {
			const reason = scores.horizon.reason.trim();
			if (reason.length > REASON_MAX)
				throw new Error(`A reason is at most ${REASON_MAX} characters.`);
			next.horizonSuggestion = { horizon: scores.horizon.horizon, reason };
		}
		if (next.status === "new") next.status = "analyzed";
		this.saveIdea(projectId, file, next);
		return { idea: next, kept };
	}

	/** The idea a Shape chat may promote: neither promoted already nor dismissed. */
	promotable(projectId: string, id: string): Idea {
		const { idea } = this.file(projectId, id);
		if (idea.status === "promoted")
			throw new Error(`${idea.id} is already promoted to ${idea.initiativeId}.`);
		if (idea.status === "dismissed")
			throw new Error(`${idea.id} is dismissed; bring it back before promoting it.`);
		return idea;
	}

	/** Links the idea to the initiative it became. */
	markPromoted(projectId: string, id: string, initiativeId: string): Idea {
		const idea = this.promotable(projectId, id);
		const file = this.store.ideas(projectId);
		const next: Idea = {
			...idea,
			status: "promoted",
			initiativeId,
			updatedAt: this.host.now(),
		};
		this.saveIdea(projectId, file, next);
		return next;
	}

	createWatch(projectId: string, input: WatchInput): WatchEntry {
		this.host.project(projectId);
		const file = this.store.watchlist(projectId);
		const at = this.host.now();
		const entry: WatchEntry = {
			id: `W-${file.nextNumber}`,
			name: input.name,
			urls: checkUrls(input.urls ?? []),
			notes: input.notes ?? "",
			createdAt: at,
			updatedAt: at,
		};
		this.saveEntry(projectId, file, entry, file.nextNumber + 1);
		return entry;
	}

	updateWatch(projectId: string, id: string, patch: WatchPatch): WatchEntry {
		const { file, entry } = this.watchFile(projectId, id);
		const next: WatchEntry = {
			...entry,
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.urls !== undefined ? { urls: checkUrls(patch.urls) } : {}),
			...(patch.notes !== undefined ? { notes: patch.notes } : {}),
			updatedAt: this.host.now(),
		};
		this.saveEntry(projectId, file, next);
		return next;
	}

	deleteWatch(projectId: string, id: string): { deleted: string } {
		const { file, entry } = this.watchFile(projectId, id);
		this.store.saveWatchlist(projectId, {
			...file,
			entries: file.entries.filter((candidate) => candidate.id !== entry.id),
		});
		this.host.changed(projectId);
		return { deleted: entry.id };
	}

	/** Stores the entry's new snapshot, keeping the last one as `previous`; answers that previous one. */
	snapshot(
		projectId: string,
		id: string,
		input: Omit<WatchSnapshot, "at">,
	): { entry: WatchEntry; previous: WatchSnapshot | null } {
		const { file, entry } = this.watchFile(projectId, id);
		const text = input.text.trim();
		if (!text) throw new Error("Pass the snapshot's text.");
		if (text.length > SNAPSHOT_MAX)
			throw new Error(`A snapshot is at most ${SNAPSHOT_MAX} characters.`);
		const at = this.host.now();
		const artifactPath = input.artifactPath ? checkRef("artifact", input.artifactPath) : undefined;
		const next: WatchEntry = {
			...entry,
			snapshot: {
				at,
				text,
				...(artifactPath ? { artifactPath } : {}),
				...(artifactPath && input.workspaceId ? { workspaceId: input.workspaceId } : {}),
			},
			...(entry.snapshot ? { previous: entry.snapshot } : {}),
			updatedAt: at,
		};
		this.saveEntry(projectId, file, next);
		return { entry: next, previous: entry.snapshot ?? null };
	}
}

function checkUrls(urls: readonly string[]): string[] {
	const kept = urls.map((url) => url.trim()).filter(Boolean);
	if (kept.length > URLS_MAX) throw new Error(`Give at most ${URLS_MAX} URLs.`);
	return kept.map((url) => checkRef("url", url));
}
