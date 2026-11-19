import type { ChatState, ThinkingLevel } from "@thinkrail/contracts";
import type { PanelHost } from "@thinkrail/extension-api/web";

type Querying = Pick<PanelHost, "query">;

export type Category =
	| "triage"
	| "backlog"
	| "unstarted"
	| "started"
	| "review"
	| "completed"
	| "canceled";
export type CardType = "feature" | "bug" | "chore";
export type CardSize = "S" | "M" | "L";
export type Workflow = "brainstorm" | "implement";
export type Preset = "agentic-kanban" | "solo";
export type GithubFilter = "open" | "mine";
export type GithubProblem = "missing" | "unauthenticated";

export const CARD_TYPES: readonly CardType[] = ["feature", "bug", "chore"];
export const CARD_SIZES: readonly CardSize[] = ["S", "M", "L"];
export const WORKFLOWS: readonly Workflow[] = ["implement", "brainstorm"];
export const PRESETS: readonly Preset[] = ["agentic-kanban", "solo"];
export const GITHUB_FILTERS: readonly GithubFilter[] = ["open", "mine"];
export const BOARD_CHANGED = "board.changed";
export const CARD_PANEL = "card";
/** The board's `layoutPresets` entry: Board mode. */
export const BOARD_MODE = "board";

export interface Attempt {
	workspaceId: string;
	sessionId: string;
	workflow: Workflow;
	startedAt: number;
	notes: { text: string; at: number }[];
	merged?: true;
	removedAt?: number;
}

export interface AttemptLive {
	workspaceId: string;
	sessionId: string;
	open: boolean;
	chat: { state: ChatState; unread: boolean; title: string } | null;
	plan: { open: number; total: number } | null;
	diff: { added: number; removed: number } | null;
	pr: { kind: string; number: number; state: string; url?: string } | null;
}

/** Where a card comes from: the board, a workspace's task-spec or a GitHub issue. */
export type CardSource =
	| { kind: "native"; ref: string }
	| { kind: "task-spec"; ref: string; workspaceId: string; path: string }
	| { kind: "github"; ref: string; number: number; url: string };

/** A task-spec of one of the card's workspaces, live from the host's spec graph. */
export interface TaskSpecRef {
	kind: "task-spec";
	workspaceId: string;
	id: string;
	title: string;
	status: string | null;
	path: string;
}

export interface Card {
	id: string;
	source: CardSource;
	title: string;
	description: string;
	acceptance: string[];
	type: CardType;
	size?: CardSize;
	sizeSuggested?: boolean;
	labels: string[];
	blocks: string[];
	specRefs: string[];
	rank: number;
	category: Category;
	column: string;
	attempts: Attempt[];
	createdBy: "human" | "agent";
	/** The chat that filed an agent's card and the card that chat works on; a human's deferrals carry the card. */
	origin?: { sessionId?: string; cardId?: string };
	createdAt: number;
	cancelPending?: { workspaceId: string; at: number };
	live: AttemptLive[];
	blockedBy: string[];
	taskSpecs: TaskSpecRef[];
	/** A source's item the board has not stored: an unbound workspace's task-spec, an untouched issue. */
	virtual?: true;
}

export interface Column {
	id: string;
	categories: Category[];
	hidden?: true;
	workflow?: Workflow;
}

export interface BoardSettings {
	preset: Preset;
	wipLimits: { needsYou: number; review: number; agents: number };
	followSelection: boolean;
	github: { enabled: boolean; filter: GithubFilter };
}

export interface GithubStatus {
	enabled: boolean;
	filter: GithubFilter;
	loading: boolean;
	fetchedAt: number | null;
	/** The last fetch's failure; the last good issues stay shown. */
	error: string | null;
}

export type WipKey = keyof BoardSettings["wipLimits"];
export const WIP_KEYS: readonly WipKey[] = ["needsYou", "review", "agents"];

export interface WipCount {
	count: number;
	limit: number;
}

export interface BoardView {
	projectId: string;
	projectName: string;
	prefix: string | null;
	settings: BoardSettings;
	columns: Column[];
	cards: Card[];
	wip: Record<WipKey, WipCount>;
	github: GithubStatus;
}

export type InboxReason = "needs_you" | "failed";

/** A card of any open project whose latest attempt waits for the human or failed. */
export interface InboxItem {
	projectId: string;
	projectName: string;
	reason: InboxReason;
	card: Card;
}

export interface Placement {
	category: Category;
	column: string;
}

export interface Transition {
	cardId: string;
	from: Placement | null;
	to: Placement | null;
	at: number;
	actor: "human" | "agent" | "git" | "automation";
	reason: string;
}

export interface CardDetail {
	projectId: string;
	card: Card;
	transitions: Transition[];
}

export interface HostModel {
	id: string;
	name: string;
	provider: string;
	thinkingLevels: ThinkingLevel[];
}

export interface StartRequest {
	workflow: Workflow;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	baseRef?: string;
}

export interface StartResult {
	card: Card;
	kickoffError?: string;
}

export type CardPatch = Partial<
	Pick<Card, "title" | "description" | "acceptance" | "type" | "specRefs" | "blocks">
> & { size?: CardSize | null };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBoardView(value: unknown): value is BoardView {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		typeof value.projectName === "string" &&
		isObject(value.settings) &&
		isObject(value.github) &&
		Array.isArray(value.columns) &&
		Array.isArray(value.cards)
	);
}

function isInboxItem(value: unknown): value is InboxItem {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		typeof value.projectName === "string" &&
		(value.reason === "needs_you" || value.reason === "failed") &&
		isObject(value.card) &&
		typeof value.card.id === "string" &&
		Array.isArray(value.card.live)
	);
}

function isInbox(value: unknown): value is { items: InboxItem[] } {
	return isObject(value) && Array.isArray(value.items) && value.items.every(isInboxItem);
}

function isCardDetail(value: unknown): value is CardDetail {
	return (
		isObject(value) &&
		typeof value.projectId === "string" &&
		isObject(value.card) &&
		Array.isArray(value.transitions)
	);
}

/** A reply the board's server half of this build never sends: an older or newer host. */
export class BoardReplyError extends Error {}

function checked<T>(value: unknown, guard: (value: unknown) => value is T): T {
	if (!guard(value)) throw new BoardReplyError("The board's host replied in an unknown shape.");
	return value;
}

export async function loadBoard(
	host: Querying,
	projectId: string,
	signal?: AbortSignal,
): Promise<BoardView> {
	return checked(await host.query("board.get", { projectId }, signal), isBoardView);
}

/** A card for Peek; `projectId` names the board of a GitHub issue's card the board has not stored. */
export async function loadCard(
	host: Querying,
	cardId: string,
	projectId: string | null,
	signal?: AbortSignal,
): Promise<CardDetail> {
	return checked(
		await host.query("card.get", { cardId, ...(projectId ? { projectId } : {}) }, signal),
		isCardDetail,
	);
}

export async function loadInbox(host: Querying, signal?: AbortSignal): Promise<InboxItem[]> {
	return checked(await host.query("inbox", {}, signal), isInbox).items;
}

export async function listModels(host: PanelHost, signal?: AbortSignal): Promise<HostModel[]> {
	const value = await host.query("models.list", {}, signal);
	return isObject(value) && Array.isArray(value.models) ? (value.models as HostModel[]) : [];
}

export async function createCard(host: PanelHost, projectId: string, title: string): Promise<Card> {
	return (await host.query("card.create", { projectId, title })) as Card;
}

/** Edits a card; an issue's card the board has not stored is stored first, on `projectId`'s board. */
export async function updateCard(
	host: PanelHost,
	cardId: string,
	patch: CardPatch,
	projectId: string,
): Promise<Card> {
	return (await host.query("card.update", { cardId, projectId, ...patch })) as Card;
}

export async function moveCard(
	host: PanelHost,
	cardId: string,
	column: string,
	projectId: string,
	rank?: number,
): Promise<void> {
	await host.query("card.move", {
		cardId,
		column,
		projectId,
		...(rank === undefined ? {} : { rank }),
	});
}

export async function deleteCard(host: PanelHost, cardId: string): Promise<void> {
	await host.query("card.delete", { cardId });
}

export async function startCard(
	host: PanelHost,
	cardId: string,
	request: StartRequest,
	projectId: string,
): Promise<StartResult> {
	return (await host.query("card.start", { cardId, projectId, ...request })) as StartResult;
}

/** Stores an unbound workspace's task-spec card, bound to that workspace. */
export async function adoptCard(host: PanelHost, cardId: string): Promise<Card> {
	return (await host.query("card.adopt", { cardId })) as Card;
}

/** Files a card's task-spec's Deferrals bullets into Triage; answers how many were new. */
export async function sendDeferrals(
	host: PanelHost,
	cardId: string,
	specId: string,
): Promise<{ created: number; skipped: number }> {
	const value = await host.query("card.deferrals", { cardId, specId });
	const reply = isObject(value) ? value : {};
	return {
		created: Array.isArray(reply.created) ? reply.created.length : 0,
		skipped: typeof reply.skipped === "number" ? reply.skipped : 0,
	};
}

/** Switches the GitHub source; a problem with the user's `gh` comes back instead of switching on. */
export async function setGithub(
	host: PanelHost,
	projectId: string,
	patch: { enabled?: boolean; filter?: GithubFilter },
): Promise<{ problem: GithubProblem | null }> {
	const value = await host.query("github.set", { projectId, ...patch });
	const problem = isObject(value) ? value.problem : null;
	return { problem: problem === "missing" || problem === "unauthenticated" ? problem : null };
}

export async function refreshGithub(host: PanelHost, projectId: string): Promise<void> {
	await host.query("github.refresh", { projectId });
}

export async function setPreset(host: PanelHost, projectId: string, preset: Preset): Promise<void> {
	await host.query("settings.update", { projectId, preset });
}

export async function setWipLimits(
	host: PanelHost,
	projectId: string,
	wipLimits: BoardSettings["wipLimits"],
): Promise<void> {
	await host.query("settings.update", { projectId, wipLimits });
}

/** Accepts Triage cards of one board into Backlog, as a whole. */
export async function acceptTriage(host: PanelHost, cardIds: readonly string[]): Promise<void> {
	await host.query("triage.accept", { cardIds });
}

/** S cards, bugs and unsized cards implement directly; M and L start by brainstorming (the server's rule). */
export function workflowFor(card: Pick<Card, "type" | "size">): Workflow {
	if (card.type === "bug") return "implement";
	return card.size === "M" || card.size === "L" ? "brainstorm" : "implement";
}

export type AgentBadge = "working" | "waiting" | "failed" | "finished" | "unread";

/** The agent's state on a card: its latest attempt's chat, while that workspace is open. */
export function agentBadge(card: Pick<Card, "live">): AgentBadge | null {
	const live = card.live.at(-1);
	if (!live?.open || !live.chat) return null;
	switch (live.chat.state) {
		case "working":
			return "working";
		case "needs_you":
			return "waiting";
		case "failed":
		case "interrupted":
			return "failed";
		case "finished":
			return live.chat.unread ? "unread" : "finished";
		case "idle":
			return null;
	}
}

export function latestLive(card: Pick<Card, "live">): AttemptLive | undefined {
	return card.live.at(-1);
}

/** The attempt whose workspace is still open, the one a double click enters. */
export function openAttempt(card: Pick<Card, "live">): AttemptLive | undefined {
	return card.live.findLast((live) => live.open);
}

/** Start is offered on a backlog or unstarted card with no attempt still running (an issue's included). */
export function canStart(card: Pick<Card, "category" | "live" | "source" | "virtual">): boolean {
	if (card.virtual && card.source.kind === "task-spec") return false;
	return (card.category === "backlog" || card.category === "unstarted") && !openAttempt(card);
}

/** An unbound workspace's task-spec card: it can only be adopted, never moved or edited. */
export function canAdopt(card: Pick<Card, "source" | "virtual">): boolean {
	return !!card.virtual && card.source.kind === "task-spec";
}

/** The id a card shows: a task-spec's card shows its spec's id, an issue's `#N`. */
export function shownId(card: Pick<Card, "id" | "source" | "virtual">): string {
	return card.virtual && card.source.kind === "task-spec" ? card.source.ref : card.id;
}

export function visibleColumns(view: Pick<BoardView, "columns">): Column[] {
	return view.columns.filter((column) => !column.hidden);
}

export function cardsIn(view: Pick<BoardView, "cards">, column: string): Card[] {
	return view.cards.filter((card) => card.column === column);
}

/** The column a card moves to by one step left or right, or `null` at the edge. */
export function adjacentColumn(
	view: Pick<BoardView, "columns">,
	card: Pick<Card, "column">,
	delta: -1 | 1,
): string | null {
	const columns = visibleColumns(view);
	const index = columns.findIndex((column) => column.id === card.column);
	if (index < 0) return null;
	return columns[index + delta]?.id ?? null;
}

/** A drop's move: onto a column other than the card's own. */
export function dropMove(
	view: Pick<BoardView, "cards">,
	cardId: string,
	column: string | null,
): { cardId: string; column: string } | null {
	if (column === null) return null;
	const card = view.cards.find((candidate) => candidate.id === cardId);
	return card && card.column !== column ? { cardId, column } : null;
}

/** A drop's write: `card.move` onto the column under the pointer, or nothing. */
export function moveOnDrop(
	host: PanelHost,
	view: Pick<BoardView, "cards" | "projectId">,
	cardId: string,
	column: string | null,
): Promise<void> | null {
	const move = dropMove(view, cardId, column);
	return move ? moveCard(host, move.cardId, move.column, view.projectId) : null;
}

export type BoardLayout = "columns" | "stacked";

/** Wide enough for the columns side by side, else one list grouped by column. */
export const COLUMNS_MIN_WIDTH = 720;

export function boardLayout(width: number): BoardLayout {
	return width >= COLUMNS_MIN_WIDTH ? "columns" : "stacked";
}

export type ListSort = "column" | "rank";

export function sortCards(view: Pick<BoardView, "columns" | "cards">, sort: ListSort): Card[] {
	const order = new Map(view.columns.map((column, index) => [column.id, index]));
	return [...view.cards].sort((a, b) =>
		sort === "column"
			? (order.get(a.column) ?? 0) - (order.get(b.column) ?? 0) || a.rank - b.rank
			: a.rank - b.rank,
	);
}

/** Where an inbox row's Answer or Retry goes: its latest attempt's chat, while that workspace is open. */
export function inboxTarget(
	item: InboxItem,
): { projectId: string; workspaceId: string; sessionId: string } | null {
	const live = item.card.live.at(-1);
	return live?.open
		? { projectId: item.projectId, workspaceId: live.workspaceId, sessionId: live.sessionId }
		: null;
}

/** A limit of 0 is no limit; a count past a limit is over it. */
export function overLimit({ count, limit }: WipCount): boolean {
	return limit > 0 && count > limit;
}

/** A column holding only Review cards shows the Review limit; others show just their count. */
export function columnWip(view: Pick<BoardView, "wip">, column: Column): WipCount | null {
	return column.categories.length > 0 &&
		column.categories.every((category) => category === "review")
		? view.wip.review
		: null;
}

/** The human-attention limits Start warns about, Review first; empty when there is room. */
export function attentionOverLimit(view: Pick<BoardView, "wip">): ("review" | "needsYou")[] {
	return (["review", "needsYou"] as const).filter((key) => overLimit(view.wip[key]));
}

export interface TriageGroup {
	/** The filing chat's session id, `card:<id>` for a card's deferrals, `""` for cards of no known origin. */
	key: string;
	/** `chat`: filed by an agent's chat; `deferrals`: a card's task-spec deferrals the human sent. */
	kind: "chat" | "deferrals" | "none";
	/** The card the filing chat works on, or whose deferrals these are. */
	cardId: string | null;
	cards: Card[];
}

/** Triage cards grouped by where they came from (a decomposition, a card's deferrals), by rank. */
export function triageGroups(view: Pick<BoardView, "cards">): TriageGroup[] {
	const groups = new Map<string, TriageGroup>();
	const triage = view.cards
		.filter((card) => card.category === "triage")
		.sort((a, b) => a.rank - b.rank);
	for (const card of triage) {
		const { sessionId, cardId } = card.origin ?? {};
		const kind = sessionId ? "chat" : cardId ? "deferrals" : "none";
		const key = sessionId ?? (cardId ? `card:${cardId}` : "");
		const group = groups.get(key) ?? { key, kind, cardId: cardId ?? null, cards: [] };
		group.cards.push(card);
		groups.set(key, group);
	}
	return [...groups.values()];
}

/** Where a task-spec opens: Peek in this workspace; another workspace's is entered first (Peek is per workspace). */
export function openTaskSpec(
	host: Pick<PanelHost, "peek" | "openFile" | "scope">,
	spec: Pick<TaskSpecRef, "workspaceId" | "path">,
): "peek" | "file" {
	if (spec.workspaceId === host.scope.workspaceId) {
		host.peek({ kind: "file", path: spec.path });
		return "peek";
	}
	host.openFile(spec.workspaceId, spec.path);
	return "file";
}
