import type { PanelHost, PanelPeekEntry } from "@thinkrail/extension-api/web";
import { BoardReplyError, type CardSize, type Category } from "./api";

type Querying = Pick<PanelHost, "query">;

export type Horizon = "now" | "next" | "later";
export type Health = "on_track" | "at_risk" | "off_track";
/** A roadmap chat the server starts in the project's Default workspace. */
export type RoadmapChat = "plan" | "shape" | "report" | "review" | "close";
export type AgentState = "working" | "waiting" | "failed";

export const HORIZONS: readonly Horizon[] = ["now", "next", "later"];
export const HEALTHS: readonly Health[] = ["on_track", "at_risk", "off_track"];
export const INITIATIVE_PANEL = "initiative";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CardRef {
	projectId: string;
	cardId: string;
}

export interface InitiativeUpdate {
	id: string;
	at: number;
	text: string;
	health: Health;
	publishedAt?: number;
}

/** An initiative as `roadmap.get` answers it: stored fields, then its place in the tree and its members. */
export interface Initiative {
	id: string;
	parentId?: string;
	title: string;
	outcome: string;
	criteria: string[];
	horizon: Horizon;
	rank: number;
	target?: string;
	appetiteDays?: number;
	specRefs: string[];
	health?: { override?: Health; note?: string };
	updates: InitiativeUpdate[];
	cardIds: string[];
	externalCards: CardRef[];
	proposed?: true;
	proposedBy?: "agent";
	/** When the human confirmed it done in an initiative-close chat. */
	closedAt?: number;
	createdAt: number;
	updatedAt: number;
	depth: number;
	childIds: string[];
	/** This board's cards it holds, its projects' and nested initiatives' included. */
	memberCardIds: string[];
	memberExternalCards: CardRef[];
}

export interface Milestone {
	id: string;
	title: string;
	target?: string;
}

export interface RoadmapProject {
	id: string;
	initiativeId?: string;
	title: string;
	milestones: Milestone[];
	proposed?: true;
	proposedBy?: "agent";
}

export type ExternalCard =
	| {
			projectId: string;
			projectName: string | null;
			cardId: string;
			title: string;
			category: Category;
			size?: CardSize;
			missing?: undefined;
	  }
	| { projectId: string; projectName: string | null; cardId: string; missing: true };

export interface Rollup {
	cards: number;
	byCategory: Record<Category, number>;
	points: { total: number; completed: number };
	agents: Record<AgentState, number>;
	blocked: number;
	timeSpentMs: number;
}

export type HealthReason =
	| { kind: "forecast_late"; level: Health; p85: string; target: string }
	| { kind: "blocked"; level: "at_risk"; cardIds: string[] }
	| { kind: "waiting"; level: "at_risk"; cardIds: string[] }
	| { kind: "review_wip"; level: "at_risk"; count: number; limit: number }
	| { kind: "failed"; level: "at_risk"; cardIds: string[] }
	| { kind: "appetite"; level: "at_risk"; usedPercent: number };

export interface HealthView {
	suggested: Health;
	effective: Health;
	override?: Health;
	note?: string;
	reasons: HealthReason[];
}

export type ForecastMiss = "no-scope" | "history" | "no-completions";

export type Forecast =
	| { status: "ok"; p50: string; p85: string; p50Weeks: number; p85Weeks: number }
	| { status: "done" }
	| { status: "insufficient"; reason: ForecastMiss };

/** A step graph node; days are days since 1970-01-01 UTC, fractional. */
export interface ScheduleNode {
	id: string;
	kind: "card" | "milestone";
	/** Its roadmap project, the graph's lane. */
	lane: string | null;
	start: number;
	end: number;
	slack: number;
	critical: boolean;
	/** A pinned start before its blockers' end. */
	conflict: boolean;
	pinned: boolean;
	done: boolean;
	late?: true;
}

/** "`from` blocks `to`", or a card ahead of its milestone. */
export interface ScheduleEdge {
	from: string;
	to: string;
	critical: boolean;
	conflict: boolean;
}

export interface Schedule {
	today: number;
	finish: number;
	/** Every node after its blockers. */
	nodes: ScheduleNode[];
	edges: ScheduleEdge[];
	criticalPath: string[];
}

export interface RoadmapView {
	projectId: string;
	projectName: string;
	/** Depth-first: each after its parent. */
	initiatives: Initiative[];
	projects: RoadmapProject[];
	externalCards: ExternalCard[];
	rollups: {
		initiatives: Record<string, Rollup>;
		projects: Record<string, Rollup>;
		milestones: Record<string, Rollup>;
	};
	health: Record<string, HealthView>;
	forecast: Record<string, Forecast>;
	schedule: Schedule;
	/** Each initiative's own critical path: the critical node ids among its cards and milestones. */
	critical: Record<string, string[]>;
	insufficientData: { throughput: boolean; initiatives: string[] };
}

export interface InitiativePatch {
	title?: string;
	outcome?: string;
	criteria?: string[];
	horizon?: Horizon;
	parentId?: string | null;
	target?: string | null;
	appetiteDays?: number | null;
	specRefs?: string[];
	health?: { override?: Health | null; note?: string | null };
	proposed?: false;
}

/** What Publish wrote: the snapshot file in the project's Default workspace. */
export interface PublishedSnapshot {
	projectId: string;
	workspaceId: string;
	path: string;
	bytes: number;
}

export interface StartedChat {
	projectId: string;
	workspaceId: string;
	sessionId: string;
	kickoff: string;
	kickoffError?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRoadmapView(value: unknown): value is RoadmapView {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		Array.isArray(value.initiatives) &&
		Array.isArray(value.projects) &&
		Array.isArray(value.externalCards) &&
		isObject(value.rollups) &&
		isObject(value.rollups.initiatives) &&
		isObject(value.health) &&
		isObject(value.forecast) &&
		isObject(value.schedule) &&
		typeof value.schedule.today === "number" &&
		Array.isArray(value.schedule.nodes) &&
		Array.isArray(value.schedule.edges) &&
		isObject(value.critical)
	);
}

function isStartedChat(value: unknown): value is StartedChat {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		typeof value.workspaceId === "string" &&
		typeof value.sessionId === "string" &&
		typeof value.kickoff === "string"
	);
}

export async function loadRoadmap(
	host: Querying,
	projectId: string,
	signal?: AbortSignal,
): Promise<RoadmapView> {
	const value = await host.query("roadmap.get", { projectId }, signal);
	if (!isRoadmapView(value))
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	return value;
}

export async function createInitiative(
	host: Querying,
	projectId: string,
	input: { title: string; horizon: Horizon },
): Promise<Initiative> {
	return (await host.query("initiative.create", { projectId, ...input })) as Initiative;
}

export async function updateInitiative(
	host: Querying,
	projectId: string,
	initiativeId: string,
	patch: InitiativePatch,
): Promise<void> {
	await host.query("initiative.update", { projectId, initiativeId, ...patch });
}

/** Accepts an agent's proposed initiative: it stays, no longer marked a proposal. */
export function acceptInitiative(host: Querying, projectId: string, initiativeId: string) {
	return updateInitiative(host, projectId, initiativeId, { proposed: false });
}

/** Discards an initiative (an agent's proposal, or one the human deletes). */
export async function deleteInitiative(
	host: Querying,
	projectId: string,
	initiativeId: string,
): Promise<void> {
	await host.query("initiative.delete", { projectId, initiativeId });
}

export async function moveInitiative(
	host: Querying,
	projectId: string,
	initiativeId: string,
	horizon: Horizon,
): Promise<void> {
	await host.query("initiative.move", { projectId, initiativeId, horizon });
}

export async function addInitiativeCards(
	host: Querying,
	projectId: string,
	initiativeId: string,
	cardIds: readonly string[],
): Promise<void> {
	await host.query("initiative.addCards", { projectId, initiativeId, cardIds });
}

export async function removeInitiativeCards(
	host: Querying,
	projectId: string,
	initiativeId: string,
	cardIds: readonly string[],
): Promise<void> {
	await host.query("initiative.removeCards", { projectId, initiativeId, cardIds });
}

export async function saveDraftUpdate(
	host: Querying,
	projectId: string,
	initiativeId: string,
	text: string,
	health: Health,
): Promise<void> {
	await host.query("initiative.updateDraft.save", { projectId, initiativeId, text, health });
}

export async function publishDraftUpdate(
	host: Querying,
	projectId: string,
	initiativeId: string,
): Promise<void> {
	await host.query("initiative.updateDraft.publish", { projectId, initiativeId });
}

export async function createRoadmapProject(
	host: Querying,
	projectId: string,
	initiativeId: string,
	title: string,
): Promise<void> {
	await host.query("project.create", { projectId, initiativeId, title });
}

export async function renameRoadmapProject(
	host: Querying,
	projectId: string,
	roadmapProjectId: string,
	title: string,
): Promise<void> {
	await host.query("project.update", { projectId, roadmapProjectId, title });
}

export async function deleteRoadmapProject(
	host: Querying,
	projectId: string,
	roadmapProjectId: string,
): Promise<void> {
	await host.query("project.delete", { projectId, roadmapProjectId });
}

export async function createMilestone(
	host: Querying,
	projectId: string,
	roadmapProjectId: string,
	title: string,
): Promise<void> {
	await host.query("milestone.create", { projectId, roadmapProjectId, title });
}

export async function updateMilestone(
	host: Querying,
	projectId: string,
	milestoneId: string,
	patch: { title?: string; target?: string | null },
): Promise<void> {
	await host.query("milestone.update", { projectId, milestoneId, ...patch });
}

export async function deleteMilestone(
	host: Querying,
	projectId: string,
	milestoneId: string,
): Promise<void> {
	await host.query("milestone.delete", { projectId, milestoneId });
}

/** Puts a card into a roadmap project or milestone of its board; `null` takes it out. */
export async function assignCard(
	host: Querying,
	cardId: string,
	place: { roadmapProjectId?: string | null; milestoneId?: string | null },
): Promise<void> {
	await host.query("card.assignProject", { cardId, ...place });
}

/** Pins a card's planned start on the step graph, an ISO date; only a card not started yet. */
export async function pinCard(host: Querying, cardId: string, start: string): Promise<void> {
	await host.query("card.pin", { cardId, start });
}

export async function unpinCard(host: Querying, cardId: string): Promise<void> {
	await host.query("card.unpin", { cardId });
}

/** Moves a card's planned start by whole `days`, with every pinned card it blocks. */
export async function shiftChain(host: Querying, cardId: string, days: number): Promise<void> {
	await host.query("card.shiftChain", { cardId, days });
}

/** "`from` blocks `to`"; the host refuses a link that closes a cycle. */
export async function linkCards(host: Querying, from: string, to: string): Promise<void> {
	await host.query("card.link", { from, to });
}

export async function unlinkCards(host: Querying, from: string, to: string): Promise<void> {
	await host.query("card.unlink", { from, to });
}

function isPublishedSnapshot(value: unknown): value is PublishedSnapshot {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		typeof value.workspaceId === "string" &&
		typeof value.path === "string" &&
		typeof value.bytes === "number"
	);
}

/** Writes the roadmap snapshot into the project's Default workspace, at `path` or the board's own. */
export async function publishSnapshot(
	host: Querying,
	projectId: string,
	path?: string,
): Promise<PublishedSnapshot> {
	const value = await host.query("roadmap.publish", { projectId, ...(path ? { path } : {}) });
	if (!isPublishedSnapshot(value))
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	return value;
}

/** Shows the written snapshot in Peek: here when Peek belongs to its workspace, else entering that one. */
export function peekSnapshot(
	host: Pick<PanelHost, "peek" | "openWorkspace" | "scope">,
	written: PublishedSnapshot,
): void {
	const entry: PanelPeekEntry = { kind: "file", path: written.path };
	if (host.scope.workspaceId === written.workspaceId) host.peek(entry);
	else
		host.openWorkspace({
			workspaceId: written.workspaceId,
			projectId: written.projectId,
			peek: entry,
		});
}

/** Starts a roadmap chat in a new chat of the project's Default workspace, then opens it. */
export async function openRoadmapChat(
	host: Pick<PanelHost, "query" | "openChat">,
	projectId: string,
	kind: RoadmapChat,
	initiativeId?: string,
): Promise<StartedChat> {
	const value = await host.query("roadmap.chat", {
		projectId,
		kind,
		...(initiativeId ? { initiativeId } : {}),
	});
	if (!isStartedChat(value))
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	host.openChat({
		projectId: value.projectId,
		workspaceId: value.workspaceId,
		sessionId: value.sessionId,
	});
	return value;
}

/** An initiative's Peek entry: the `initiative` panel on its board. */
export function initiativePeekEntry(
	projectId: string,
	initiative: Pick<Initiative, "id" | "title">,
): PanelPeekEntry {
	return {
		kind: "extension",
		panel: INITIATIVE_PANEL,
		params: { projectId, initiativeId: initiative.id },
		title: `${initiative.id} · ${initiative.title}`,
	};
}

/** The stack bar's categories, left to right; Triage and Canceled stay out of it. */
export const STACK_CATEGORIES = ["completed", "review", "started", "unstarted", "backlog"] as const;
export type StackCategory = (typeof STACK_CATEGORIES)[number];

export interface RollupBar {
	/** Each non-empty category's share of the bar, in percent, with where it starts. */
	segments: { category: StackCategory; count: number; start: number; width: number }[];
	done: number;
	/** The cards the bar counts: neither in Triage nor canceled. */
	total: number;
	/** Done of total, rounded; 0 without cards. */
	percent: number;
	triage: number;
}

/** A rollup as the stack bar draws it and its figures read ("x/y cards · n %"). */
export function rollupBar(rollup: Pick<Rollup, "byCategory"> | undefined): RollupBar {
	const counts = rollup?.byCategory;
	const total = STACK_CATEGORIES.reduce((sum, category) => sum + (counts?.[category] ?? 0), 0);
	const segments: RollupBar["segments"] = [];
	let start = 0;
	for (const category of STACK_CATEGORIES) {
		const count = counts?.[category] ?? 0;
		if (count === 0 || total === 0) continue;
		const width = (100 * count) / total;
		segments.push({ category, count, start, width });
		start += width;
	}
	const done = counts?.completed ?? 0;
	return {
		segments,
		done,
		total,
		percent: total > 0 ? Math.round((100 * done) / total) : 0,
		triage: counts?.triage ?? 0,
	};
}

/** Time spent in days against the appetite, one decimal; `null` without an appetite. */
export function appetiteUsed(
	initiative: Pick<Initiative, "appetiteDays">,
	rollup: Pick<Rollup, "timeSpentMs"> | undefined,
): { used: number; appetite: number; percent: number } | null {
	const appetite = initiative.appetiteDays;
	if (appetite === undefined || appetite <= 0) return null;
	const used = Math.round(((rollup?.timeSpentMs ?? 0) / DAY_MS) * 10) / 10;
	return { used, appetite, percent: Math.min(100, Math.round((100 * used) / appetite)) };
}

/** An initiative on a horizon column: with its goal (the top-level ancestor) and a parent between them. */
export interface HorizonEntry {
	initiative: Initiative;
	goal: Initiative | null;
	/** The direct parent when it is not the goal itself. */
	parent: Initiative | null;
}

const byRank = (a: Initiative, b: Initiative) => a.rank - b.rank || a.createdAt - b.createdAt;

function ancestors(initiative: Initiative, byId: ReadonlyMap<string, Initiative>): Initiative[] {
	const chain: Initiative[] = [];
	const seen = new Set([initiative.id]);
	let parent = initiative.parentId ? byId.get(initiative.parentId) : undefined;
	while (parent && !seen.has(parent.id)) {
		chain.unshift(parent);
		seen.add(parent.id);
		parent = parent.parentId ? byId.get(parent.parentId) : undefined;
	}
	return chain;
}

/** Every initiative, top-level or nested, on its horizon's column by rank. */
export function horizonColumns(
	view: Pick<RoadmapView, "initiatives">,
): Record<Horizon, HorizonEntry[]> {
	const byId = new Map(view.initiatives.map((initiative) => [initiative.id, initiative]));
	const columns: Record<Horizon, HorizonEntry[]> = { now: [], next: [], later: [] };
	for (const initiative of [...view.initiatives].sort(byRank)) {
		const chain = ancestors(initiative, byId);
		const goal = chain[0] ?? null;
		const parent = chain.at(-1) ?? null;
		columns[initiative.horizon].push({
			initiative,
			goal,
			parent: parent && parent.id !== goal?.id ? parent : null,
		});
	}
	return columns;
}

/** The Goals view: each top-level initiative with its descendants in tree order. */
export function goalGroups(
	view: Pick<RoadmapView, "initiatives">,
): { goal: Initiative; initiatives: Initiative[] }[] {
	const byId = new Map(view.initiatives.map((initiative) => [initiative.id, initiative]));
	const groups: { goal: Initiative; initiatives: Initiative[] }[] = [];
	for (const initiative of view.initiatives) {
		const root = ancestors(initiative, byId)[0];
		if (!root) groups.push({ goal: initiative, initiatives: [] });
		else groups.find((group) => group.goal.id === root.id)?.initiatives.push(initiative);
	}
	return groups;
}

/** The initiatives a horizon drop changes: onto another horizon than the initiative's own. */
export function horizonMove(
	view: Pick<RoadmapView, "initiatives">,
	initiativeId: string,
	horizon: string | null,
): { initiativeId: string; horizon: Horizon } | null {
	const target = HORIZONS.find((candidate) => candidate === horizon);
	const initiative = view.initiatives.find((candidate) => candidate.id === initiativeId);
	return target && initiative && initiative.horizon !== target
		? { initiativeId, horizon: target }
		: null;
}

/**
 * The initiatives each one waits for: another's card blocks one of its cards. A card counts for the
 * deepest initiative holding it, and an initiative never waits for its own ancestors or descendants.
 */
export function initiativeDependencies(
	view: Pick<RoadmapView, "initiatives" | "schedule">,
): Map<string, Initiative[]> {
	const byId = new Map(view.initiatives.map((initiative) => [initiative.id, initiative]));
	const owner = new Map<string, Initiative>();
	for (const initiative of view.initiatives)
		for (const cardId of initiative.memberCardIds) {
			const held = owner.get(cardId);
			if (!held || held.depth < initiative.depth) owner.set(cardId, initiative);
		}
	const related = (a: Initiative, b: Initiative) =>
		ancestors(a, byId).some((entry) => entry.id === b.id) ||
		ancestors(b, byId).some((entry) => entry.id === a.id);
	const after = new Map<string, Initiative[]>();
	for (const edge of view.schedule.edges) {
		const before = owner.get(edge.from);
		const waiting = owner.get(edge.to);
		if (!before || !waiting || before.id === waiting.id || related(before, waiting)) continue;
		const list = after.get(waiting.id) ?? [];
		if (!list.some((entry) => entry.id === before.id)) list.push(before);
		after.set(waiting.id, list);
	}
	return after;
}

/** The initiatives an initiative can move under: any but itself and those nested in it. */
export function parentOptions(
	view: Pick<RoadmapView, "initiatives">,
	initiativeId: string,
): Initiative[] {
	const byId = new Map(view.initiatives.map((initiative) => [initiative.id, initiative]));
	return view.initiatives.filter(
		(candidate) =>
			candidate.id !== initiativeId &&
			!ancestors(candidate, byId).some((entry) => entry.id === initiativeId),
	);
}

/** The initiative's draft update, the one a save replaces and a publish stamps. */
export function draftUpdate(initiative: Pick<Initiative, "updates">): InitiativeUpdate | undefined {
	return initiative.updates.find((update) => update.publishedAt === undefined);
}
