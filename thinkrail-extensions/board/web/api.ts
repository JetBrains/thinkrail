import type { ChatState, ThinkingLevel } from "@thinkrail/contracts";
import type { PanelHost, PanelPeekEntry } from "@thinkrail/extension-api/web";

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
export type Preset = "agentic-kanban" | "solo" | "spec-driven";
export type GithubFilter = "open" | "mine";
export type GithubProblem = "missing" | "unauthenticated";

export const CARD_TYPES: readonly CardType[] = ["feature", "bug", "chore"];
export const CARD_SIZES: readonly CardSize[] = ["S", "M", "L"];
export const WORKFLOWS: readonly Workflow[] = ["implement", "brainstorm"];
export const PRESETS: readonly Preset[] = ["agentic-kanban", "solo", "spec-driven"];
export const GITHUB_FILTERS: readonly GithubFilter[] = ["open", "mine"];
export const BOARD_CHANGED = "board.changed";
/** A bound chat's tool start: only cards' last actions moved, so tiles re-read and the inbox does not. */
export const BOARD_ACTIVITY = "board.activity";
export const CARD_PANEL = "card";
/** The board's `layoutPresets` entry: Board mode. */
export const BOARD_MODE = "board";

export type Verdict = "met" | "unmet" | "untested";
export const VERDICTS: readonly Verdict[] = ["met", "unmet", "untested"];

/** Where the reviewer saw a requirement met or missed: a worktree-relative path, a line, and why. */
export interface ReviewEvidence {
	path: string;
	line?: number;
	note: string;
}

/** One requirement of a smart review with the reviewer's advisory verdict. */
export interface ReviewItem {
	id: string;
	source: "criterion" | "task-spec" | "openspec";
	text: string;
	scenarios?: string[];
	verdict: Verdict;
	evidence: ReviewEvidence[];
	tests: string[];
	/** The Review comment an unmet item became. */
	commentId?: string;
}

/** An attempt's latest smart review. */
export interface AttemptReview {
	at: number;
	items: ReviewItem[];
	summary: string;
}

export interface Attempt {
	workspaceId: string;
	sessionId: string;
	workflow: Workflow;
	startedAt: number;
	notes: { text: string; at: number }[];
	merged?: true;
	removedAt?: number;
	/** Absent from an older host. */
	review?: AttemptReview;
}

/** A chat's most recent tool start, a host fact: the tool and a short target (a path, a command's start). */
export interface LastAction {
	tool: string;
	target?: string;
	at: number;
}

export interface AttemptLive {
	workspaceId: string;
	sessionId: string;
	open: boolean;
	chat: { state: ChatState; unread: boolean; title: string; lastAction?: LastAction } | null;
	plan: { open: number; total: number } | null;
	diff: { added: number; removed: number } | null;
	pr: { kind: string; number: number; state: string; url?: string } | null;
}

/** Where a card comes from: the board, a workspace's task-spec, a GitHub issue or an OpenSpec change. */
export type CardSource =
	| { kind: "native"; ref: string }
	| { kind: "task-spec"; ref: string; workspaceId: string; path: string }
	| { kind: "github"; ref: string; number: number; url: string }
	| { kind: "openspec"; ref: string; change: string };

export type OpenspecStage = "planning" | "ready" | "in-progress" | "complete" | "archived";
export type ArtifactStatus = "done" | "ready" | "blocked" | "skipped";

export interface DeltaCount {
	capability: string;
	path: string;
	added: number;
	modified: number;
	removed: number;
	renamed: number;
}

/** An OpenSpec change on its card, live from the workspace it was read in (the apply one while applying). */
export interface OpenspecOverlay {
	change: string;
	workspaceId: string;
	dir: string;
	archived: boolean;
	stage: OpenspecStage;
	schema: string;
	/** Why the artifact chain is unknown (a schema OpenSpec could not resolve). */
	error?: string;
	artifacts: { id: string; status: ArtifactStatus; files: string[] }[];
	nextArtifact: string | null;
	tasks: { completed: number; total: number };
	deltas: DeltaCount[];
	validation: { valid: boolean; errors: number; warnings: number } | null;
	source: "cli" | "files";
	/** The card in Peek only. */
	requirements?: { capability: string; operation: string; name: string }[];
	taskLines?: { done: boolean; text: string; path: string; line: number }[];
}

/** The project's OpenSpec: whether Default has `openspec/`, and the user's CLI version (`null` without). */
export interface OpenspecStatus {
	present: boolean;
	cli: string | null;
	checking: boolean;
}

export interface ValidationIssue {
	level: "ERROR" | "WARNING" | "INFO";
	message: string;
	path?: string;
	line?: number;
}

export interface ChangeValidation {
	change: string;
	workspaceId: string;
	valid: boolean;
	errors: number;
	warnings: number;
	issues: ValidationIssue[];
}

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
	/** Its roadmap project (`P-n`) and one of that project's milestones. */
	roadmapProjectId?: string;
	milestoneId?: string;
	/** Its planned start pinned on the step graph, an ISO date. */
	pinnedStart?: string;
	/** The initiative it serves, live: its roadmap project's, else one listing it, on this board or another. */
	initiative?: ServedInitiative;
	/** An OpenSpec change's card: the change, live. */
	openspec?: OpenspecOverlay;
	/** A source's item the board has not stored: an unbound workspace's task-spec, an untouched issue. */
	virtual?: true;
	/** A smart review of its latest attempt is running. */
	reviewing?: true;
	/** Why its last smart review failed. */
	reviewError?: string;
}

export interface ServedInitiative {
	projectId: string;
	id: string;
	title: string;
	outcome: string;
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
	/** Where Publish writes the roadmap snapshot; absent from an older host. */
	snapshotPath?: string;
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
	/** Absent from an older host. */
	openspec?: OpenspecStatus;
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
	/** Apply started, but carrying the change or writing its `x-thinkrail` into the workspace failed. */
	openspecError?: string;
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

export async function setFollowSelection(
	host: PanelHost,
	projectId: string,
	followSelection: boolean,
): Promise<void> {
	await host.query("settings.update", { projectId, followSelection });
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

/** What a working card's agent is doing: its latest attempt's last action, only while it works. */
export function workingAction(card: Pick<Card, "live">): LastAction | undefined {
	return agentBadge(card) === "working" ? latestLive(card)?.chat?.lastAction : undefined;
}

/** The attempt whose workspace is still open, the one a double click enters. */
export function openAttempt(card: Pick<Card, "live">): AttemptLive | undefined {
	return card.live.findLast((live) => live.open);
}

/** A card's Peek entry: the `card` panel on its board. */
export function cardPeekEntry(
	projectId: string,
	card: Pick<Card, "id" | "title" | "source" | "virtual">,
): PanelPeekEntry {
	return {
		kind: "extension",
		panel: CARD_PANEL,
		params: { projectId, cardId: card.id },
		title: `${shownId(card)} · ${card.title}`,
	};
}

/**
 * A click on a card: Peek. With follow selection on, a card with an open attempt also switches to that
 * attempt's workspace (on its chat), the card shown in that workspace's Peek.
 */
export function selectCard(
	host: Pick<PanelHost, "peek" | "openWorkspace">,
	projectId: string,
	card: Pick<Card, "id" | "title" | "source" | "virtual" | "live">,
	followSelection: boolean,
): "peek" | "follow" {
	const entry = cardPeekEntry(projectId, card);
	const attempt = followSelection ? openAttempt(card) : undefined;
	if (!attempt) {
		host.peek(entry);
		return "peek";
	}
	host.openWorkspace({
		workspaceId: attempt.workspaceId,
		projectId,
		...(attempt.chat ? { sessionId: attempt.sessionId } : {}),
		peek: entry,
	});
	return "follow";
}

/** Double click or Enter's switch: the card's open attempt's workspace, on its chat. */
export function enterCard(
	host: Pick<PanelHost, "openWorkspace">,
	projectId: string,
	card: Pick<Card, "live">,
): boolean {
	const attempt = openAttempt(card);
	if (!attempt) return false;
	host.openWorkspace({
		workspaceId: attempt.workspaceId,
		projectId,
		...(attempt.chat ? { sessionId: attempt.sessionId } : {}),
	});
	return true;
}

/**
 * Start is offered on a backlog or unstarted card with no attempt still running (an issue's included); an
 * OpenSpec change's card offers Apply instead.
 */
export function canStart(card: Pick<Card, "category" | "live" | "source" | "virtual">): boolean {
	if (card.virtual && card.source.kind === "task-spec") return false;
	if (card.source.kind === "openspec") return false;
	return (card.category === "backlog" || card.category === "unstarted") && !openAttempt(card);
}

/** Apply is offered on an OpenSpec change with tasks written, not archived, and no attempt running. */
export function canApply(card: Pick<Card, "live" | "source" | "openspec">): boolean {
	const change = card.openspec;
	return (
		card.source.kind === "openspec" &&
		!!change &&
		!change.archived &&
		change.tasks.total > 0 &&
		!openAttempt(card)
	);
}

/** Archive in workspace is offered while an attempt's workspace is open with the change not archived. */
export function canArchive(card: Pick<Card, "live" | "source" | "openspec" | "virtual">): boolean {
	return (
		card.source.kind === "openspec" &&
		!card.virtual &&
		!!card.openspec &&
		!card.openspec.archived &&
		!!openAttempt(card)?.chat
	);
}

/** The presets the switch offers: Spec-driven only for a project whose Default workspace has `openspec/`. */
export function presetsFor(view: Pick<BoardView, "openspec" | "settings">): Preset[] {
	return PRESETS.filter(
		(preset) =>
			preset !== "spec-driven" || !!view.openspec?.present || view.settings.preset === preset,
	);
}

/** Where an artifact of a change opens: Peek in this workspace, else that workspace's file tab. */
export function openChangeFile(
	host: Pick<PanelHost, "peek" | "openFile" | "scope">,
	change: Pick<OpenspecOverlay, "workspaceId">,
	path: string,
): "peek" | "file" {
	return openTaskSpec(host, { workspaceId: change.workspaceId, path });
}

/** A change's delta on one capability as its chip says it: `+2 ~1 −1 →1`, zero counts left out. */
export function deltaText(
	delta: Pick<DeltaCount, "added" | "modified" | "removed" | "renamed">,
): string {
	return [
		delta.added ? `+${delta.added}` : "",
		delta.modified ? `~${delta.modified}` : "",
		delta.removed ? `−${delta.removed}` : "",
		delta.renamed ? `→${delta.renamed}` : "",
	]
		.filter(Boolean)
		.join(" ");
}

export async function validateChange(
	host: Pick<PanelHost, "query">,
	cardId: string,
	projectId: string,
): Promise<ChangeValidation> {
	return (await host.query("openspec.validate", { cardId, projectId })) as ChangeValidation;
}

/** Asks the card's apply chat to archive the change there and update the PR. */
export async function archiveChange(
	host: Pick<PanelHost, "query">,
	cardId: string,
	projectId: string,
): Promise<{ sessionId: string; workspaceId: string }> {
	return (await host.query("openspec.archive", { cardId, projectId })) as {
		sessionId: string;
		workspaceId: string;
	};
}

/** A chat in the Default workspace proposing a change from `description`, then that chat opened. */
export async function proposeChange(
	host: Pick<PanelHost, "query" | "openChat">,
	projectId: string,
	description: string,
): Promise<{ workspaceId: string; sessionId: string; kickoffError?: string }> {
	const value = await host.query("openspec.propose", { projectId, description });
	if (
		!isObject(value) ||
		typeof value.workspaceId !== "string" ||
		typeof value.sessionId !== "string"
	)
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	host.openChat({ projectId, workspaceId: value.workspaceId, sessionId: value.sessionId });
	return {
		workspaceId: value.workspaceId,
		sessionId: value.sessionId,
		...(typeof value.kickoffError === "string" ? { kickoffError: value.kickoffError } : {}),
	};
}

/** An unbound workspace's task-spec card: it can only be adopted, never moved or edited. */
export function canAdopt(card: Pick<Card, "source" | "virtual">): boolean {
	return !!card.virtual && card.source.kind === "task-spec";
}

/** The id a card shows: a task-spec's card shows its spec's id, an issue's `#N`, an unstored change its name. */
export function shownId(card: Pick<Card, "id" | "source" | "virtual">): string {
	if (!card.virtual) return card.id;
	if (card.source.kind === "task-spec") return card.source.ref;
	return card.source.kind === "openspec" ? card.source.change : card.id;
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

/** The limit Start asks about first, with its figures; `null` when there is room or no board yet. */
export function attentionWarning(
	view: Pick<BoardView, "wip"> | null,
): { key: "review" | "needsYou"; n: number; limit: number } | null {
	const [key] = view ? attentionOverLimit(view) : [];
	return view && key ? { key, n: view.wip[key].count, limit: view.wip[key].limit } : null;
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

export interface Tally {
	met: number;
	unmet: number;
	untested: number;
	total: number;
}

/** A card's review packet, as `card.packet` answers it. */
export interface Packet {
	cardId: string;
	title: string;
	why: { goal: string; initiative?: { id: string; title: string; outcome: string } };
	what: { summary: string | null; steps: { title: string; status: string; summary?: string }[] };
	verified: { title: string; verification: string }[];
	conformance: (AttemptReview & { tally: Tally }) | null;
	time: { agentMs: number; waitingMs: number };
	diff: { added: number; removed: number } | null;
	markdown: string;
}

/** The latest attempt's smart review, if it has one. */
export function latestReview(card: Pick<Card, "attempts">): AttemptReview | undefined {
	return card.attempts.at(-1)?.review;
}

export function tallyOf(review: Pick<AttemptReview, "items">): Tally {
	const count = (verdict: Verdict) =>
		review.items.filter((item) => item.verdict === verdict).length;
	return {
		met: count("met"),
		unmet: count("unmet"),
		untested: count("untested"),
		total: review.items.length,
	};
}

/** Smart review needs a stored card whose latest attempt's workspace is open. */
export function canReview(card: Pick<Card, "attempts" | "live" | "virtual">): boolean {
	return !card.virtual && card.attempts.length > 0 && !!card.live.at(-1)?.open;
}

/** Add to PR needs the latest attempt's pull request. */
export function packetPr(card: Pick<Card, "live">): number | null {
	const pr = card.live.at(-1)?.pr;
	return pr?.kind === "pull-request" ? pr.number : null;
}

/** Starts a smart review; its verdicts land on the card with the next `board.changed`. */
export async function reviewCard(host: Pick<PanelHost, "query">, cardId: string): Promise<void> {
	await host.query("card.review", { cardId });
}

function isPacket(value: unknown): value is Packet {
	return (
		isObject(value) &&
		typeof value.cardId === "string" &&
		typeof value.markdown === "string" &&
		isObject(value.why) &&
		isObject(value.what) &&
		Array.isArray(value.verified) &&
		isObject(value.time)
	);
}

export async function loadPacket(
	host: Pick<PanelHost, "query">,
	cardId: string,
	signal?: AbortSignal,
): Promise<Packet> {
	return checked(await host.query("card.packet", { cardId }, signal), isPacket);
}

/** Upserts the packet's section in the attempt's PR description; `updated: false` when it was there. */
export async function packetToPr(
	host: Pick<PanelHost, "query">,
	cardId: string,
): Promise<{ pr: number; updated: boolean }> {
	const value = await host.query("card.packetToPr", { cardId });
	if (!isObject(value) || typeof value.pr !== "number" || typeof value.updated !== "boolean")
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	return { pr: value.pr, updated: value.updated };
}

/** Where evidence opens: Peek at its line in this workspace, else a tab in its own workspace. */
export function openEvidence(
	host: Pick<PanelHost, "peek" | "openFile" | "scope">,
	workspaceId: string,
	evidence: Pick<ReviewEvidence, "path" | "line">,
): "peek" | "file" {
	if (workspaceId === host.scope.workspaceId) {
		host.peek({
			kind: "file",
			path: evidence.path,
			...(evidence.line ? { line: evidence.line } : {}),
		});
		return "peek";
	}
	host.openFile(workspaceId, evidence.path, evidence.line);
	return "file";
}

/** A duration as the packet says it: `35m`, `2h 05m`. */
export function durationText(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}m`;
}
