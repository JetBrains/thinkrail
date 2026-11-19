import type { PanelHost, PanelPeekEntry } from "@thinkrail/extension-api/web";
import { BoardReplyError } from "./api";
import { type Horizon, openStartedChat, peekWorkspaceFile, type StartedChat } from "./roadmapApi";

type Querying = Pick<PanelHost, "query">;

export type IdeaStatus = "new" | "analyzed" | "promoted" | "dismissed";
export type EvidenceKind = "artifact" | "url" | "note";
/** A discovery chat the server starts in the project's Default workspace. */
export type DiscoveryChat = "research" | "analyze" | "watch";
export type ScoreKey = "value" | "effort";

export const IDEA_PANEL = "idea";
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["url", "artifact", "note"];
export const SCORE_KEYS: readonly ScoreKey[] = ["value", "effort"];
export const SCORES: readonly number[] = [1, 2, 3, 4, 5];

export interface Evidence {
	id: string;
	kind: EvidenceKind;
	ref: string;
	quote?: string;
	workspaceId?: string;
	addedBy: "human" | "agent";
	at: number;
}

export interface IdeaScore {
	score: number;
	reasons: string[];
	/** The agent's, until a human set or confirmed it. */
	suggested: boolean;
}

/** An idea as `discovery.get` answers it, with the initiative it became while that exists. */
export interface Idea {
	id: string;
	title: string;
	pitch: string;
	evidence: Evidence[];
	value?: IdeaScore;
	effort?: IdeaScore;
	horizonSuggestion?: { horizon: Horizon; reason: string };
	status: IdeaStatus;
	initiativeId?: string;
	initiative?: { id: string; title: string };
	createdAt: number;
	updatedAt: number;
}

export interface WatchSnapshot {
	at: number;
	text: string;
	artifactPath?: string;
	workspaceId?: string;
}

export interface WatchEntry {
	id: string;
	name: string;
	urls: string[];
	notes: string;
	snapshot?: WatchSnapshot;
	/** The snapshot before the last one: what the diff compares against. */
	previous?: WatchSnapshot;
	createdAt: number;
	updatedAt: number;
}

export interface DiscoveryView {
	projectId: string;
	projectName: string;
	ideas: Idea[];
	watchlist: WatchEntry[];
}

export interface IdeaPatch {
	title?: string;
	pitch?: string;
	value?: { score: number; reasons?: string[] } | null;
	effort?: { score: number; reasons?: string[] } | null;
	dismissed?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDiscoveryView(value: unknown): value is DiscoveryView {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		Array.isArray(value.ideas) &&
		value.ideas.every(
			(idea) =>
				isObject(idea) &&
				typeof idea.id === "string" &&
				typeof idea.title === "string" &&
				Array.isArray(idea.evidence),
		) &&
		Array.isArray(value.watchlist) &&
		value.watchlist.every(
			(entry) => isObject(entry) && typeof entry.id === "string" && Array.isArray(entry.urls),
		)
	);
}

export async function loadDiscovery(
	host: Querying,
	projectId: string,
	signal?: AbortSignal,
): Promise<DiscoveryView> {
	const value = await host.query("discovery.get", { projectId }, signal);
	if (!isDiscoveryView(value))
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	return value;
}

export async function createIdea(host: Querying, projectId: string, title: string): Promise<Idea> {
	return (await host.query("idea.create", { projectId, title })) as Idea;
}

export async function updateIdea(
	host: Querying,
	projectId: string,
	ideaId: string,
	patch: IdeaPatch,
): Promise<void> {
	await host.query("idea.update", { projectId, ideaId, ...patch });
}

/** A human's score: set (its reasons kept), or cleared with `null`; either way no longer a suggestion. */
export function setScore(
	host: Querying,
	projectId: string,
	ideaId: string,
	key: ScoreKey,
	score: number | null,
) {
	return updateIdea(host, projectId, ideaId, { [key]: score === null ? null : { score } });
}

/** Confirms the agent's suggested score as it is, reasons included: it is the human's from now on. */
export function confirmScore(host: Querying, projectId: string, idea: Idea, key: ScoreKey) {
	const current = idea[key];
	return current
		? updateIdea(host, projectId, idea.id, { [key]: { score: current.score } })
		: Promise.resolve();
}

export async function deleteIdea(host: Querying, projectId: string, ideaId: string): Promise<void> {
	await host.query("idea.delete", { projectId, ideaId });
}

/** Adds a human's evidence; an artifact's path is relative to the panel's workspace. */
export async function addEvidence(
	host: Pick<PanelHost, "query" | "scope">,
	projectId: string,
	ideaId: string,
	input: { kind: EvidenceKind; ref: string; quote?: string },
): Promise<void> {
	await host.query("idea.addEvidence", {
		projectId,
		ideaId,
		kind: input.kind,
		ref: input.ref,
		...(input.quote ? { quote: input.quote } : {}),
		...(input.kind === "artifact" ? { workspaceId: host.scope.workspaceId } : {}),
	});
}

export async function removeEvidence(
	host: Querying,
	projectId: string,
	ideaId: string,
	evidenceId: string,
): Promise<void> {
	await host.query("idea.removeEvidence", { projectId, ideaId, evidenceId });
}

/** Promote: a Shape chat on the idea in the Default workspace, opened. */
export function promoteIdea(
	host: Pick<PanelHost, "query" | "openChat">,
	projectId: string,
	ideaId: string,
): Promise<StartedChat> {
	return openStartedChat(host, "idea.promote", { projectId, ideaId });
}

/** Research or Analyze an idea, or ask the watchlist (or one entry) what changed, in a new chat. */
export function openDiscoveryChat(
	host: Pick<PanelHost, "query" | "openChat">,
	projectId: string,
	kind: DiscoveryChat,
	target: { ideaId?: string; watchId?: string } = {},
): Promise<StartedChat> {
	return openStartedChat(host, "discovery.chat", { projectId, kind, ...target });
}

export async function createWatch(
	host: Querying,
	projectId: string,
	input: { name: string; urls: string[]; notes: string },
): Promise<void> {
	await host.query("watchlist.create", { projectId, ...input });
}

export async function updateWatch(
	host: Querying,
	projectId: string,
	watchId: string,
	patch: { name?: string; urls?: string[]; notes?: string },
): Promise<void> {
	await host.query("watchlist.update", { projectId, watchId, ...patch });
}

export async function deleteWatch(
	host: Querying,
	projectId: string,
	watchId: string,
): Promise<void> {
	await host.query("watchlist.delete", { projectId, watchId });
}

/** An idea's Peek entry: the `idea` panel on its board. */
export function ideaPeekEntry(projectId: string, idea: Pick<Idea, "id" | "title">): PanelPeekEntry {
	return {
		kind: "extension",
		panel: IDEA_PANEL,
		params: { projectId, ideaId: idea.id },
		title: `${idea.id} · ${idea.title}`,
	};
}

/** An http(s) link to show as one; anything else is shown as text. */
export function safeHref(ref: string): string | null {
	try {
		const url = new URL(ref);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

/** Shows a report (an artifact evidence, a snapshot's) in Peek, in the workspace it was written in. */
export function openReport(
	host: Pick<PanelHost, "peek" | "openWorkspace" | "scope">,
	projectId: string,
	file: { path: string; workspaceId?: string },
): void {
	peekWorkspaceFile(host, {
		projectId,
		workspaceId: file.workspaceId ?? host.scope.workspaceId,
		path: file.path,
	});
}

const idNumber = (id: string) => Number(id.replace(/^\D+-/, "")) || 0;
const GROUP: Readonly<Record<IdeaStatus, number>> = {
	new: 0,
	analyzed: 0,
	promoted: 1,
	dismissed: 2,
};

/** The ranked list: open ideas, then promoted, then dismissed; within, value high to low, effort low to high. */
export function rankIdeas(ideas: readonly Idea[]): Idea[] {
	return [...ideas].sort(
		(a, b) =>
			GROUP[a.status] - GROUP[b.status] ||
			(b.value?.score ?? 0) - (a.value?.score ?? 0) ||
			(a.effort?.score ?? 6) - (b.effort?.score ?? 6) ||
			idNumber(a.id) - idNumber(b.id),
	);
}

export type Quadrant = "quick-win" | "big-bet" | "filler" | "time-sink";
export const QUADRANTS: readonly Quadrant[] = ["big-bet", "quick-win", "time-sink", "filler"];
/** Value and effort split between 2 and 3: a 3 counts as high on either axis. */
export const SCORE_SPLIT = 2.5;

export function quadrantOf(value: number, effort: number): Quadrant {
	const high = value > SCORE_SPLIT;
	const costly = effort > SCORE_SPLIT;
	if (high) return costly ? "big-bet" : "quick-win";
	return costly ? "time-sink" : "filler";
}

export const MATRIX_HEIGHT = 260;
export const MATRIX_PAD = { left: 40, right: 12, top: 12, bottom: 36 };
/** A dot's diameter, px. */
export const DOT = 16;

export interface MatrixPoint {
	idea: Idea;
	value: number;
	effort: number;
	/** The dot's centre. */
	x: number;
	y: number;
	quadrant: Quadrant;
	/** Either score is still the agent's suggestion. */
	suggested: boolean;
	/** How many ideas share its cell (spread side by side). */
	shared: number;
}

export interface MatrixLayout {
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	/** A score's cell centre on the effort (x) and value (y) axes. */
	xOf: (effort: number) => number;
	yOf: (value: number) => number;
	/** Where the quadrants split. */
	split: { x: number; y: number };
	points: MatrixPoint[];
	/** Ideas shown with both scores missing one: the list only. */
	unscored: Idea[];
}

/**
 * The value × effort matrix: effort left (low) to right, value bottom (low) to top, each score a cell's
 * centre; the dismissed left out; ideas sharing a cell spread side by side within it.
 */
export function matrixLayout(
	ideas: readonly Idea[],
	width: number,
	height: number = MATRIX_HEIGHT,
): MatrixLayout {
	const left = MATRIX_PAD.left;
	const right = Math.max(left + 5 * DOT, width - MATRIX_PAD.right);
	const top = MATRIX_PAD.top;
	const bottom = Math.max(top + 5 * DOT, height - MATRIX_PAD.bottom);
	const cellX = (right - left) / 5;
	const cellY = (bottom - top) / 5;
	const xOf = (effort: number) => left + (effort - 0.5) * cellX;
	const yOf = (value: number) => bottom - (value - 0.5) * cellY;
	const shown = rankIdeas(ideas).filter((idea) => idea.status !== "dismissed");
	const cells = new Map<string, Idea[]>();
	const unscored: Idea[] = [];
	for (const idea of shown) {
		if (!idea.value || !idea.effort) {
			unscored.push(idea);
			continue;
		}
		const key = `${idea.value.score}:${idea.effort.score}`;
		cells.set(key, [...(cells.get(key) ?? []), idea]);
	}
	const points: MatrixPoint[] = [];
	for (const group of cells.values()) {
		const step = group.length > 1 ? Math.min(DOT + 4, (cellX - DOT) / (group.length - 1)) : 0;
		group.forEach((idea, index) => {
			const value = idea.value?.score ?? 0;
			const effort = idea.effort?.score ?? 0;
			points.push({
				idea,
				value,
				effort,
				x: xOf(effort) + (index - (group.length - 1) / 2) * step,
				y: yOf(value),
				quadrant: quadrantOf(value, effort),
				suggested: Boolean(idea.value?.suggested || idea.effort?.suggested),
				shared: group.length,
			});
		});
	}
	return {
		width,
		height,
		left,
		right,
		top,
		bottom,
		xOf,
		yOf,
		split: { x: xOf(SCORE_SPLIT), y: yOf(SCORE_SPLIT) },
		points,
		unscored,
	};
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };
export type DiffItem = DiffLine | { kind: "skip"; count: number };

/** Lines past which the diff gives up on matching and shows the old text out, the new one in. */
const DIFF_MAX_CELLS = 4_000_000;

/** A line diff of two snapshots (longest common subsequence), in order. */
export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.replace(/\r\n/g, "\n").split("\n");
	const b = after.replace(/\r\n/g, "\n").split("\n");
	const n = a.length;
	const m = b.length;
	if ((n + 1) * (m + 1) > DIFF_MAX_CELLS)
		return [
			...a.map((text): DiffLine => ({ kind: "removed", text })),
			...b.map((text): DiffLine => ({ kind: "added", text })),
		];
	const width = m + 1;
	const lcs = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i -= 1)
		for (let j = m - 1; j >= 0; j -= 1)
			lcs[i * width + j] =
				a[i] === b[j]
					? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
					: Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const left = a[i] ?? "";
		const right = b[j] ?? "";
		if (left === right) {
			lines.push({ kind: "same", text: left });
			i += 1;
			j += 1;
		} else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
			lines.push({ kind: "removed", text: left });
			i += 1;
		} else {
			lines.push({ kind: "added", text: right });
			j += 1;
		}
	}
	for (; i < n; i += 1) lines.push({ kind: "removed", text: a[i] ?? "" });
	for (; j < m; j += 1) lines.push({ kind: "added", text: b[j] ?? "" });
	return lines;
}

/** The diff as shown: unchanged runs longer than twice `context` lines fold to a count, changes kept. */
export function diffHunks(lines: readonly DiffLine[], context = 2): DiffItem[] {
	const items: DiffItem[] = [];
	let run: DiffLine[] = [];
	const flush = (first: boolean, last: boolean) => {
		const head = first ? 0 : context;
		const tail = last ? 0 : context;
		if (run.length > head + tail + 1) {
			items.push(...run.slice(0, head));
			items.push({ kind: "skip", count: run.length - head - tail });
			items.push(...run.slice(run.length - tail));
		} else items.push(...run);
		run = [];
	};
	let first = true;
	for (const line of lines) {
		if (line.kind === "same") {
			run.push(line);
			continue;
		}
		flush(first, false);
		first = false;
		items.push(line);
	}
	flush(first, true);
	return items;
}
