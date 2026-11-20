import { userInfo } from "node:os";
import type {
	ChatState,
	ExtensionChatFacts,
	ExtensionContainer,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionTaskSpec,
	ExtensionWorkspaceFacts,
	GhSetupProblem,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/extension-api/server";
import { type PilotCard, type PilotWip, select, type Unready, unready } from "./autopilot";
import { Autopilot, type AutopilotView } from "./autopilotService";
import { isoOfDay, today } from "./days";
import { Discovery } from "./discovery";
import {
	closesIssue,
	GH_TIMEOUT_MS,
	type GithubIssue,
	type GithubStatus,
	IssueCache,
	issueCardId,
	issueType,
	parseIssueCardId,
	parsePrBody,
	runError,
	withCloses,
} from "./github";
import { allocatePrefix, cardId, parseCardId } from "./ids";
import {
	autopilotRule,
	type DiscoveryChat,
	discoveryKickoff,
	kickoffText,
	openspecApplyKickoff,
	openspecArchiveMessage,
	openspecProposeKickoff,
	type RoadmapChat,
	roadmapKickoff,
	runBrief,
	WAKE_RUN,
	workflowFor,
} from "./kickoff";
import {
	type Attempt,
	type AttemptReview,
	type AutopilotPause,
	type BoardSettings,
	type Card,
	type CardOrigin,
	type CardSize,
	type CardSource,
	type CardType,
	type Category,
	type GithubSettings,
	type Initiative,
	type Placement,
	TEXT_MAX,
	TITLE_MAX,
	type Transition,
	type WipLimits,
	type Workflow,
} from "./model";
import {
	OPENSPEC_TIMEOUT_MS,
	type OpenspecChange,
	OpenspecReader,
	type OpenspecSnapshot,
	parseOpenspec,
	SPEC_DRIVEN,
	stageOf,
	upsertTopLevelKey,
	type Validation,
} from "./openspec";
import {
	findChange,
	type OpenspecOverlay,
	type OpenspecStatus,
	openspecCardId,
	overlayOf,
	parseOpenspecCardId,
	STAGE_CATEGORIES,
} from "./openspecCards";
import { type ColumnDef, columnFor, columnOfCard, columnsOf, placeInColumn } from "./presets";
import {
	assembleRequirements,
	type Packet,
	PRODUCT_HEADING,
	packetOf,
	type Requirement,
	reviewItems,
	SMART_REVIEW_AUTHOR,
	timeSplit,
	unmetComments,
	upsertPacket,
} from "./review";
import { Roadmap } from "./roadmap";
import { applyEvent, type BoardEvent, moveByHand } from "./rules";
import { wouldCycle } from "./schedule";
import {
	parseSize,
	SIZE_DEBOUNCE_MS,
	SIZE_MAX_TOKENS,
	SizeQueue,
	sizePrompt,
	wantsSize,
} from "./sizing";
import { roadmapSnapshot } from "./snapshot";
import { BoardStore, CARDS_VERSION, type CardsFile } from "./store";
import {
	attemptChat,
	DEFERRALS_HEADING,
	type Deferral,
	isActiveTaskSpec,
	latestChat,
	liveCategory,
	parseDeferrals,
	parseTaskSpecCardId,
	type TaskSpecRef,
	taskSpecCardId,
	taskSpecRef,
} from "./taskSpecs";

export const BOARD_CHANGED = "board.changed";
/** At most this many requirements go to one smart review (the host's own limit). */
const REVIEW_REQUIREMENTS_MAX = 200;

export interface AttemptLive {
	workspaceId: string;
	sessionId: string;
	/** The workspace is still open. */
	open: boolean;
	chat: {
		state: ChatState;
		unread: boolean;
		title: string;
		lastAction?: ExtensionChatFacts["lastAction"];
	} | null;
	plan: { open: number; total: number } | null;
	diff: { added: number; removed: number } | null;
	pr: ExtensionWorkspaceFacts["review"];
}

/** The initiative a card serves (`Roadmap.initiativesOf`), on its board or another. */
export interface ServedInitiative {
	projectId: string;
	id: string;
	title: string;
	outcome: string;
}

/**
 * A card with its live state, computed per request from host facts and never stored: its attempts'
 * overlays, the cards blocking it, its workspaces' task-specs and the initiative it serves. A `virtual`
 * card is a source's item the board has not stored (an unbound workspace's task-spec, a GitHub issue
 * nobody started or edited).
 */
export type CardView = Card & {
	live: AttemptLive[];
	blockedBy: string[];
	taskSpecs: TaskSpecRef[];
	initiative?: ServedInitiative;
	/** An OpenSpec change's card: the change as its attempt's workspace (else Default) has it. */
	openspec?: OpenspecOverlay;
	virtual?: true;
	/** A smart review of its latest attempt is running now. */
	reviewing?: true;
	/** Why its last smart review failed, until the next one starts (kept in memory). */
	reviewError?: string;
};

/** A card's task-spec's deferrals the board has no card for yet. */
export interface CardDeferrals {
	cardId: string;
	specId: string;
	deferrals: Deferral[];
}

export interface WipCount {
	count: number;
	limit: number;
}

export interface Wip {
	needsYou: WipCount;
	review: WipCount;
	agents: WipCount;
}

export interface BoardView {
	projectId: string;
	projectName: string;
	/** `null` until the project's first card. */
	prefix: string | null;
	settings: BoardSettings;
	columns: readonly ColumnDef[];
	cards: CardView[];
	wip: Wip;
	github: GithubStatus;
	openspec: OpenspecStatus;
}

/** `openspec validate <change> --strict`'s verdict, from the workspace the card reads the change in. */
export type ChangeValidation = Validation & { change: string; workspaceId: string };

/** A chat the board started in a project's Default workspace, for the web half to open. */
export interface StartedChat {
	projectId: string;
	workspaceId: string;
	sessionId: string;
	kickoff: string;
	kickoffError?: string;
}

export interface InboxItem {
	projectId: string;
	projectName: string;
	reason: "needs_you" | "failed";
	card: CardView;
}

export interface CardDetail {
	projectId: string;
	card: CardView;
	transitions: Transition[];
}

export interface CardInput {
	title: string;
	/** An agent's card: the chat that filed it. */
	origin?: CardOrigin;
	description?: string;
	acceptance?: string[];
	type?: CardType;
	size?: CardSize;
	labels?: string[];
	specRefs?: string[];
	column?: string;
}

export interface CardPatch {
	title?: string;
	description?: string;
	acceptance?: string[];
	type?: CardType;
	/** `null` clears the size. */
	size?: CardSize | null;
	labels?: string[];
	specRefs?: string[];
	blocks?: string[];
	/** `false` dismisses the cancel question. */
	cancelPending?: false;
	/** `null` falls back to the size's. */
	estimateDays?: number | null;
}

/** One card of an agent's decomposition: `blocksIndex` names the batch's cards it blocks, by position. */
export interface BatchCardInput {
	title: string;
	description?: string;
	acceptance?: string[];
	type?: CardType;
	size?: CardSize;
	blocksIndex?: number[];
}

export interface StartOptions {
	workflow?: Workflow;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	baseRef?: string;
	/** The container the workspace joins; by default the card's initiative's, while it exists. */
	into?: string;
	/** A note appended to the kickoff, and who wrote it (the orchestrator's `board_card_start`). */
	note?: { from: string; text: string };
	/** Why the start is logged (actor `automation`): Run, the orchestrator, or by default a plain start. */
	reason?: string;
}

/** What Run answers: the initiative's container, its orchestrator's chat, and the card it started. */
export interface RunResult {
	projectId: string;
	initiativeId: string;
	containerId: string;
	orchestrator: { projectId: string; workspaceId: string; sessionId: string };
	started: { cardId: string; workspaceId: string; sessionId: string; kickoffError?: string } | null;
}

export interface SettingsPatch {
	preset?: BoardSettings["preset"];
	wipLimits?: Partial<WipLimits>;
	followSelection?: boolean;
}

/** A stored card about to be written: what `createCard` and the sources' materializers fill in. */
interface Draft {
	title: string;
	source?: CardSource;
	description?: string;
	acceptance?: string[];
	type?: CardType;
	size?: CardSize;
	sizeSuggested?: true;
	labels?: string[];
	specRefs?: string[];
	placement: Placement;
	attempts?: Attempt[];
	origin?: CardOrigin;
	/** The drafts written with it that it blocks, by position. */
	blocksIndex?: number[];
	/** Its roadmap project. */
	roadmapProjectId?: string;
	reason: string;
}

export interface BoardOptions {
	now?: () => number;
	owner?: string;
	/** How long a size suggestion waits for more edits. */
	sizeDelayMs?: number;
	issueTtlMs?: number;
	/** How often a running chat's tool starts re-publish its board, at most. */
	actionRefreshMs?: number;
	/** How long board changes gather before autopilot looks again. */
	autopilotDelayMs?: number;
	/** How long an offered card may stay unstarted before it is offered again. */
	offerRetryMs?: number;
}

export interface Located {
	projectId: string;
	file: CardsFile;
	card: Card;
}

const byRank = (a: Card, b: Card) => a.rank - b.rank || a.createdAt - b.createdAt;
const finished = (card: Pick<Card, "category">) =>
	card.category === "completed" || card.category === "canceled";

function localUser(): string {
	try {
		return userInfo().username || "me";
	} catch {
		return "me";
	}
}

/** An attempt's live overlay; an attempt adopted without a chat follows its workspace's latest one. */
export function attemptLive(
	attempt: Pick<Attempt, "workspaceId" | "sessionId" | "removedAt">,
	facts: ExtensionWorkspaceFacts | null,
): AttemptLive {
	if (!facts || attempt.removedAt !== undefined)
		return {
			workspaceId: attempt.workspaceId,
			sessionId: attempt.sessionId,
			open: false,
			chat: null,
			plan: null,
			diff: null,
			pr: null,
		};
	const chat = attemptChat(attempt, facts);
	return {
		workspaceId: attempt.workspaceId,
		sessionId: chat?.sessionId ?? attempt.sessionId,
		open: true,
		chat: chat
			? {
					state: chat.state,
					unread: chat.unread,
					title: chat.title,
					...(chat.lastAction ? { lastAction: chat.lastAction } : {}),
				}
			: null,
		plan: chat?.plan ?? null,
		diff: facts.diff,
		pr: facts.review,
	};
}

const latestChatState = (view: CardView): ChatState | undefined => view.live.at(-1)?.chat?.state;

/** Why a card's latest chat state puts it in the inbox: an interrupted run counts as failed, as its badge does. */
function inboxReason(state: ChatState | undefined): InboxItem["reason"] | null {
	if (state === "needs_you") return "needs_you";
	return state === "failed" || state === "interrupted" ? "failed" : null;
}

/** Human attention (Needs you, Review) and running agents against the board's limits. */
export function wipOf(views: readonly CardView[], limits: WipLimits): Wip {
	const active = views.filter((view) => !finished(view));
	const count = (state: ChatState) =>
		active.filter((view) => latestChatState(view) === state).length;
	return {
		needsYou: { count: count("needs_you"), limit: limits.needsYou },
		review: {
			count: views.filter((view) => view.category === "review").length,
			limit: limits.review,
		},
		agents: { count: count("working"), limit: limits.agents },
	};
}

const isPlanDone = (plan: { open: number; total: number } | null | undefined): boolean =>
	!!plan && plan.total > 0 && plan.open === 0;

const reviewSignature = (workspace: Workspace): string =>
	workspace.review
		? `${workspace.review.kind}#${workspace.review.number}:${workspace.review.state ?? "open"}`
		: "";

const chatSignature = ({ state }: SessionStateRecord): string =>
	[
		state.execution,
		state.needsInput ? "input" : "",
		state.completion?.outcome ?? "",
		state.completionUnread ? "unread" : "",
		state.backgroundWork ? "background" : "",
	].join(":");

const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const sameTitle = (left: string, right: string) =>
	left.trim().toLowerCase() === right.trim().toLowerCase();

const isDisabledError = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: unknown }).code === "EXTENSION_DISABLED";

const INSTALL_OPENSPEC =
	"Install the OpenSpec CLI (npm install -g @fission-ai/openspec) for the board to run it.";

/** A card's latest attempt whose workspace is still open. */
function openAttemptOf(
	card: Pick<Card, "attempts">,
	facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
): Attempt | undefined {
	return card.attempts.findLast(
		(attempt) => attempt.removedAt === undefined && !!facts.get(attempt.workspaceId),
	);
}

/** One board read's OpenSpec: each workspace's snapshot read once, and the project's CLI as probed. */
interface OpenspecReads {
	defaultId: string | null;
	read(workspaceId: string): Promise<OpenspecSnapshot | null>;
	cli(): { version: string | null; checking: boolean };
}

/** A source item shown as a card: never stored, so it has no attempts, links or history. */
function virtualCard(
	fields: Pick<Card, "id" | "source" | "title" | "category" | "column" | "rank"> &
		Partial<Pick<Card, "description" | "type" | "labels" | "specRefs" | "createdAt">>,
): Card {
	return {
		description: "",
		acceptance: [],
		type: "feature",
		labels: [],
		blocks: [],
		specRefs: [],
		ownerHuman: "",
		attempts: [],
		createdBy: "human",
		createdAt: 0,
		updatedAt: fields.createdAt ?? 0,
		...fields,
	};
}

function issueSource(issue: GithubIssue): CardSource {
	return { kind: "github", ref: issueCardId(issue.number), number: issue.number, url: issue.url };
}

const LINK_RETRY_MS = 5 * 60_000;
const ACTION_REFRESH_MS = 2_000;

/** Calls `fire(key)` at once, then at most once per `ms` per key while hits keep coming (the last one included). */
function throttled(
	fire: (key: string) => void,
	ms: number,
): { hit(key: string): void; stop(): void } {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const pending = new Set<string>();
	const arm = (key: string) =>
		timers.set(
			key,
			setTimeout(() => {
				if (!pending.delete(key)) {
					timers.delete(key);
					return;
				}
				fire(key);
				arm(key);
			}, ms),
		);
	return {
		hit(key) {
			if (timers.has(key)) {
				pending.add(key);
				return;
			}
			fire(key);
			arm(key);
		},
		stop() {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			pending.clear();
		},
	};
}

/** Why Run (or a start) waits for the human: the attention limit that is past, worded. */
function pauseRefusal(pause: AutopilotPause, initiativeId: string): string {
	switch (pause.kind) {
		case "review":
			return `Review is over its limit (${pause.count}/${pause.limit}): finish reviews before running ${initiativeId}.`;
		case "needs_you":
			return `Needs you is over its limit (${pause.count}/${pause.limit}): answer the waiting chats before running ${initiativeId}.`;
		case "orchestrator":
			return `${initiativeId}'s container has no orchestrator.`;
	}
}

function nothingToRun(initiativeId: string, cards: readonly PilotCard[], ready: number): string {
	if (cards.length === 0) return `${initiativeId} has no cards yet: plan it into cards first.`;
	if (ready > 0)
		return `The board runs as many agents as its limit allows: wait for one to finish before running ${initiativeId}.`;
	return `No card of ${initiativeId} is ready to start: a ready card is in Ready, has a size, no blocker left and no open attempt.`;
}

function unreadyRefusal(cardId: string, reason: Unready): string {
	switch (reason.kind) {
		case "category":
			return `${cardId} is not ready to start: it is ${reason.category}, and only a card in Ready (unstarted) starts.`;
		case "blocked":
			return `${cardId} is blocked by ${reason.by.map((blocker) => `${blocker.id} (${blocker.category})`).join(", ")}: it starts once those are done.`;
		case "active":
			return `${cardId} already has an open attempt.`;
		case "unsized":
			return `${cardId} has no size.`;
	}
}

/** One board service per data folder: the store, the rules over host events and the queries' reads. */
export class Board {
	readonly host: ExtensionHostServices;
	readonly store: BoardStore;
	readonly roadmap: Roadmap;
	readonly discovery: Discovery;
	private readonly now: () => number;
	private readonly owner: string;
	private readonly actionRefreshMs: number;
	private index: Map<string, { projectId: string; cardId: string }> | null = null;
	private chain: Promise<void> = Promise.resolve();
	private readonly starting = new Set<string>();
	private readonly signatures = new Map<string, string>();
	private readonly issues: IssueCache;
	private readonly sizes: SizeQueue;
	/** Unbound workspaces the last read showed as task-spec cards, by project: their chats move them. */
	private readonly watched = new Map<string, string>();
	/** A PR whose `Closes #N` check failed, by `workspaceId#pr`: when to try again. */
	private readonly linkRetry = new Map<string, number>();
	private readonly openspec: OpenspecReader;
	/** Each project's Default workspace's changes as the last read saw them, by name: what a write stores. */
	private readonly openspecSeen = new Map<string, Map<string, OpenspecChange>>();
	/** Smart reviews running now, by card id, and the last failure of each card's. */
	private readonly reviewing = new Map<string, Promise<void>>();
	private readonly reviewFailures = new Map<string, string>();
	readonly autopilot: Autopilot;

	constructor(host: ExtensionHostServices, options: BoardOptions = {}) {
		this.host = host;
		this.now = options.now ?? Date.now;
		this.owner = options.owner ?? localUser();
		this.actionRefreshMs = options.actionRefreshMs ?? ACTION_REFRESH_MS;
		this.store = new BoardStore(host.dataDir, host.log, this.now);
		this.issues = new IssueCache({
			run: (workspaceId, argv) =>
				this.host.actions.runInWorkspace({ workspaceId, argv, timeoutMs: GH_TIMEOUT_MS }),
			now: this.now,
			onChange: (projectId) => this.changed(projectId),
			...(options.issueTtlMs !== undefined ? { ttlMs: options.issueTtlMs } : {}),
		});
		this.openspec = new OpenspecReader({
			tree: (workspaceId) => this.host.openspecTree(workspaceId),
			run: (workspaceId, argv) =>
				this.host.actions.runInWorkspace({ workspaceId, argv, timeoutMs: OPENSPEC_TIMEOUT_MS }),
			now: this.now,
			onChange: (projectId) => this.changed(projectId),
		});
		this.sizes = new SizeQueue(
			(id) => this.suggestSize(id),
			options.sizeDelayMs ?? SIZE_DEBOUNCE_MS,
			host.signal,
		);
		this.roadmap = new Roadmap({
			store: this.store,
			now: this.now,
			project: (projectId) => this.project(projectId),
			locate: (id) => this.locate(id),
			saveCards: (projectId, file) => {
				this.store.saveCards(projectId, file);
				this.reindex(projectId, file);
			},
			changed: (projectId) => this.changed(projectId),
			facts: (cards) => this.facts(cards),
		});
		this.discovery = new Discovery({
			store: this.store,
			now: this.now,
			project: (projectId) => this.project(projectId),
			changed: (projectId) => this.changed(projectId),
		});
		this.autopilot = new Autopilot(
			{
				host,
				roadmap: this.roadmap,
				now: this.now,
				inputs: (projectId, initiative) => this.pilotInputs(projectId, initiative),
				changed: (projectId) => this.changed(projectId),
			},
			{
				...(options.autopilotDelayMs !== undefined ? { delayMs: options.autopilotDelayMs } : {}),
				...(options.offerRetryMs !== undefined ? { retryMs: options.offerRetryMs } : {}),
			},
		);
	}

	private repositories(): ExtensionHostProject[] {
		return this.host
			.sessionScope({ kind: "all" })
			.projects.filter((project) => project.kind === "repository");
	}

	private project(projectId: string): ExtensionHostProject {
		const project = this.repositories().find((candidate) => candidate.id === projectId);
		if (!project) throw new Error(`No open project ${projectId}.`);
		return project;
	}

	private fileFor(project: ExtensionHostProject): CardsFile {
		const existing = this.store.cards(project.id);
		if (existing) return existing;
		const taken = new Set(
			this.store
				.projectIds()
				.filter((id) => id !== project.id)
				.flatMap((id) => this.safeCards(id)?.prefix ?? []),
		);
		return {
			version: CARDS_VERSION,
			prefix: allocatePrefix(project.name, taken),
			nextNumber: 1,
			cards: [],
		};
	}

	private safeCards(projectId: string): CardsFile | null {
		try {
			return this.store.cards(projectId);
		} catch (error) {
			this.host.log.warn(`the board of project ${projectId} is unreadable`, error);
			return null;
		}
	}

	private write(projectId: string, file: CardsFile, transitions: readonly Transition[]): void {
		this.store.saveCards(projectId, file);
		this.store.appendTransitions(projectId, transitions);
		this.reindex(projectId, file);
		this.changed(projectId);
	}

	private replace(file: CardsFile, card: Card): CardsFile {
		return {
			...file,
			cards: file.cards.map((candidate) => (candidate.id === card.id ? card : candidate)),
		};
	}

	private locate(id: string): Located {
		const parsed = parseCardId(id);
		if (!parsed) throw new Error(`Not a card id: ${id}`);
		const wanted = cardId(parsed.prefix, parsed.number);
		for (const projectId of this.store.projectIds()) {
			const file = this.safeCards(projectId);
			if (file?.prefix !== parsed.prefix) continue;
			const card = file.cards.find((candidate) => candidate.id === wanted);
			if (card) return { projectId, file, card };
		}
		throw new Error(`Unknown card ${wanted}.`);
	}

	/**
	 * The stored card a write acts on: a GitHub issue's card (`#N`) is stored first, so its board state
	 * persists; a task-spec's card has to be adopted first.
	 */
	private writable(id: string, projectId?: string): Located {
		const issue = parseIssueCardId(id);
		if (issue !== null) {
			if (!projectId) throw new Error(`Pass the projectId of issue ${id}'s board.`);
			return this.materializeIssue(projectId, issue);
		}
		if (parseTaskSpecCardId(id)) throw new Error("Adopt this task-spec's card before changing it.");
		const change = parseOpenspecCardId(id);
		if (change !== null) {
			if (!projectId) throw new Error(`Pass the projectId of ${id}'s board.`);
			return this.materializeOpenspec(projectId, change);
		}
		return this.locate(id);
	}

	private bound(workspaceId: string): { projectId: string; cardId: string } | undefined {
		if (!this.index) {
			this.index = new Map();
			for (const projectId of this.store.projectIds()) {
				const file = this.safeCards(projectId);
				if (file) this.indexInto(projectId, file);
			}
		}
		return this.index.get(workspaceId);
	}

	private indexInto(projectId: string, file: CardsFile): void {
		for (const card of file.cards)
			for (const attempt of card.attempts)
				this.index?.set(attempt.workspaceId, { projectId, cardId: card.id });
	}

	private reindex(projectId: string, file: CardsFile): void {
		if (!this.index) return;
		for (const [workspaceId, entry] of this.index)
			if (entry.projectId === projectId) this.index.delete(workspaceId);
		this.indexInto(projectId, file);
	}

	private async factsOf(
		ids: Iterable<string>,
	): Promise<Map<string, ExtensionWorkspaceFacts | null>> {
		return new Map(
			await Promise.all(
				[...new Set(ids)].map(
					async (id) => [id, await this.host.workspaceFacts(id).catch(() => null)] as const,
				),
			),
		);
	}

	private facts(cards: readonly Card[]): Promise<Map<string, ExtensionWorkspaceFacts | null>> {
		return this.factsOf(
			cards.flatMap((card) =>
				card.attempts
					.filter((attempt) => attempt.removedAt === undefined)
					.map((attempt) => attempt.workspaceId),
			),
		);
	}

	private async specsOf(ids: Iterable<string>): Promise<Map<string, readonly ExtensionTaskSpec[]>> {
		const entries = await Promise.all(
			[...new Set(ids)].map(
				async (id) => [id, (await this.host.taskSpecs(id).catch(() => null)) ?? []] as const,
			),
		);
		return new Map(entries);
	}

	/** The task-specs of a card's open attempts' workspaces, each once. */
	private taskSpecsOn(
		card: Card,
		specs: ReadonlyMap<string, readonly ExtensionTaskSpec[]>,
	): TaskSpecRef[] {
		const refs: TaskSpecRef[] = [];
		const seen = new Set<string>();
		for (const attempt of card.attempts) {
			if (attempt.removedAt !== undefined) continue;
			for (const spec of specs.get(attempt.workspaceId) ?? []) {
				const key = `${attempt.workspaceId}\0${spec.id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				refs.push(taskSpecRef(attempt.workspaceId, spec));
			}
		}
		return refs;
	}

	private view(
		card: Card,
		facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
		all: readonly Card[],
		specs: ReadonlyMap<string, readonly ExtensionTaskSpec[]> = new Map(),
		served: ReadonlyMap<string, { projectId: string; initiative: Initiative }> = new Map(),
	): CardView {
		const initiative = served.get(card.id);
		const reviewError = this.reviewFailures.get(card.id);
		return {
			...card,
			...(this.reviewing.has(card.id) ? { reviewing: true as const } : {}),
			...(reviewError ? { reviewError } : {}),
			live: card.attempts.map((attempt) =>
				attemptLive(attempt, facts.get(attempt.workspaceId) ?? null),
			),
			blockedBy: all.filter((other) => other.blocks.includes(card.id)).map((other) => other.id),
			taskSpecs: this.taskSpecsOn(card, specs),
			...(initiative
				? {
						initiative: {
							projectId: initiative.projectId,
							id: initiative.initiative.id,
							title: initiative.initiative.title,
							outcome: initiative.initiative.outcome,
						},
					}
				: {}),
		};
	}

	/** The open workspaces of a project no card's attempt holds. */
	private unboundWorkspaces(project: ExtensionHostProject, cards: readonly Card[]): string[] {
		const held = new Set(
			cards.flatMap((card) => card.attempts.map((attempt) => attempt.workspaceId)),
		);
		return project.workspaces
			.filter((workspace) => workspace.kind !== "chat" && !held.has(workspace.id))
			.map((workspace) => workspace.id);
	}

	/** Each unbound workspace's open task-specs as cards, placed by the workspace's live state. */
	private async taskSpecCards(
		project: ExtensionHostProject,
		cards: readonly Card[],
		settings: BoardSettings,
		rank: number,
	): Promise<CardView[]> {
		const unbound = this.unboundWorkspaces(project, cards);
		const specs = await this.specsOf(unbound);
		const open = unbound.filter((id) => (specs.get(id) ?? []).some(isActiveTaskSpec));
		const facts = await this.factsOf(open);
		for (const [workspaceId, projectId] of this.watched)
			if (projectId === project.id) this.watched.delete(workspaceId);
		const views: CardView[] = [];
		for (const workspaceId of open) {
			const workspaceFacts = facts.get(workspaceId) ?? null;
			if (!workspaceFacts) continue;
			this.watched.set(workspaceId, project.id);
			const category = liveCategory(workspaceFacts);
			const live = attemptLive({ workspaceId, sessionId: "" }, workspaceFacts);
			for (const spec of (specs.get(workspaceId) ?? []).filter(isActiveTaskSpec)) {
				views.push({
					...virtualCard({
						id: taskSpecCardId(workspaceId, spec.id),
						source: { kind: "task-spec", ref: spec.id, workspaceId, path: spec.path },
						title: spec.title,
						specRefs: [spec.id],
						category,
						column: columnFor(settings.preset, category),
						rank: rank + views.length,
					}),
					live: [live],
					blockedBy: [],
					taskSpecs: [taskSpecRef(workspaceId, spec)],
					virtual: true,
				});
			}
		}
		return views;
	}

	private defaultWorkspace(project: ExtensionHostProject): string | null {
		return project.workspaces.find((workspace) => workspace.kind === "default")?.id ?? null;
	}

	private issueView(issue: GithubIssue, settings: BoardSettings, rank: number): CardView {
		const updated = Date.parse(issue.updatedAt);
		return {
			...virtualCard({
				id: issueCardId(issue.number),
				source: issueSource(issue),
				title: issue.title,
				description: issue.body,
				type: issueType(issue),
				labels: issue.labels,
				category: "backlog",
				column: columnFor(settings.preset, "backlog"),
				rank,
				createdAt: Number.isFinite(updated) ? updated : 0,
			}),
			live: [],
			blockedBy: [],
			taskSpecs: [],
			virtual: true,
		};
	}

	/** The project's open issues no stored card links yet, as Backlog cards; read from the cache. */
	private issueCards(
		project: ExtensionHostProject,
		cards: readonly Card[],
		settings: BoardSettings,
		rank: number,
	): CardView[] {
		if (!settings.github.enabled) return [];
		const linked = new Set(
			cards.flatMap((card) => (card.source.kind === "github" ? [card.source.number] : [])),
		);
		return this.issues
			.read(project.id, this.defaultWorkspace(project), settings.github.filter)
			.filter((issue) => !linked.has(issue.number))
			.map((issue, index) => this.issueView(issue, settings, rank + index));
	}

	private githubStatus(projectId: string, github: GithubSettings): GithubStatus {
		return this.issues.status(projectId, github.enabled, github.filter);
	}

	/** One read's OpenSpec access: each workspace's snapshot read at most once, the CLI probed in Default. */
	private openspecReads(project: ExtensionHostProject): OpenspecReads {
		const defaultId = this.defaultWorkspace(project);
		const reads = new Map<string, Promise<OpenspecSnapshot | null>>();
		return {
			defaultId,
			cli: () => this.openspec.cli(project.id),
			read: (workspaceId) => {
				let read = reads.get(workspaceId);
				if (!read) {
					read = this.openspec
						.read(project.id, workspaceId, defaultId ?? workspaceId)
						.then((snapshot) => {
							if (workspaceId === defaultId)
								this.openspecSeen.set(
									project.id,
									new Map((snapshot?.changes ?? []).map((change) => [change.name, change])),
								);
							return snapshot;
						});
					reads.set(workspaceId, read);
				}
				return read;
			},
		};
	}

	/**
	 * The change an OpenSpec card names, as its open attempt's workspace has it (the apply branch, live),
	 * else as the Default workspace has it.
	 */
	private async changeOf(
		reads: OpenspecReads,
		card: Pick<Card, "source" | "attempts">,
		facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
	): Promise<{ change: OpenspecChange; snapshot: OpenspecSnapshot } | null> {
		if (card.source.kind !== "openspec") return null;
		const name = card.source.change;
		const attempt = openAttemptOf(card, facts);
		for (const workspaceId of [attempt?.workspaceId, reads.defaultId]) {
			if (!workspaceId) continue;
			const snapshot = await reads.read(workspaceId);
			const change = snapshot ? findChange(snapshot.changes, name) : undefined;
			if (snapshot && change) return { change, snapshot };
		}
		return null;
	}

	private openspecStatus(reads: OpenspecReads, present: boolean): OpenspecStatus {
		const { version, checking } = reads.cli();
		return { present, cli: present ? version : null, checking: present && checking };
	}

	/** A change no stored card names, as a card placed by its stage. */
	private openspecView(
		change: OpenspecChange,
		snapshot: OpenspecSnapshot,
		settings: BoardSettings,
		rank: number,
		detail = false,
	): CardView {
		const category = STAGE_CATEGORIES[stageOf(change)];
		return {
			...virtualCard({
				id: openspecCardId(change.name),
				source: { kind: "openspec", ref: change.name, change: change.name },
				title: clip(change.title, TITLE_MAX),
				description: clip(change.summary, TEXT_MAX),
				category,
				column: columnFor(settings.preset, category),
				rank,
			}),
			live: [],
			blockedBy: [],
			taskSpecs: [],
			openspec: overlayOf(change, snapshot, detail),
			virtual: true,
		};
	}

	/**
	 * The project's OpenSpec on its board: each stored change card's overlay and the Default workspace's
	 * changes no stored card names, as virtual cards. Default is watched while it has `openspec/`, so a
	 * chat proposing there moves the board.
	 */
	private async openspecCards(
		project: ExtensionHostProject,
		views: readonly CardView[],
		facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
		settings: BoardSettings,
		rank: number,
	): Promise<{ status: OpenspecStatus; views: CardView[]; virtual: CardView[] }> {
		const reads = this.openspecReads(project);
		const base = reads.defaultId ? await reads.read(reads.defaultId) : null;
		if (base && reads.defaultId) this.watched.set(reads.defaultId, project.id);
		const claimed = new Set<string>();
		const overlaid: CardView[] = [];
		for (const view of views) {
			const found = await this.changeOf(reads, view, facts);
			if (view.source.kind === "openspec" && base) {
				const named = findChange(base.changes, view.source.change);
				if (named) claimed.add(named.name);
			}
			overlaid.push(found ? { ...view, openspec: overlayOf(found.change, found.snapshot) } : view);
		}
		const virtual = base
			? base.changes
					.filter((change) => !claimed.has(change.name))
					.map((change, index) => this.openspecView(change, base, settings, rank + index))
			: [];
		return { status: this.openspecStatus(reads, base !== null), views: overlaid, virtual };
	}

	async get(projectId: string): Promise<BoardView> {
		const project = this.project(projectId);
		const file = this.store.cards(projectId);
		const settings = this.store.settings(projectId);
		const cards = [...(file?.cards ?? [])].sort(byRank);
		const facts = await this.facts(cards);
		const specs = await this.specsOf(
			cards.flatMap((card) =>
				card.attempts
					.filter((attempt) => attempt.removedAt === undefined && facts.get(attempt.workspaceId))
					.map((attempt) => attempt.workspaceId),
			),
		);
		const served = this.roadmap.initiativesOf(projectId, cards);
		const stored = cards.map((card) => this.view(card, facts, cards, specs, served));
		const rank = Math.max(0, ...cards.map((card) => card.rank)) + 1;
		const fromSpecs = await this.taskSpecCards(project, cards, settings, rank);
		const fromIssues = this.issueCards(project, cards, settings, rank + fromSpecs.length);
		const openspec = await this.openspecCards(
			project,
			stored,
			facts,
			settings,
			rank + fromSpecs.length + fromIssues.length,
		);
		const views = openspec.views;
		return {
			projectId,
			projectName: project.name,
			prefix: file?.prefix ?? null,
			settings,
			columns: columnsOf(settings.preset),
			cards: [...views, ...fromSpecs, ...fromIssues, ...openspec.virtual],
			wip: wipOf(views, settings.wipLimits),
			github: this.githubStatus(projectId, settings.github),
			openspec: openspec.status,
		};
	}

	/** Cards across the open projects whose latest attempt waits for the human, failed or was interrupted. */
	async inbox(): Promise<{ items: InboxItem[] }> {
		const items: InboxItem[] = [];
		for (const project of this.repositories()) {
			const file = this.safeCards(project.id);
			if (!file) continue;
			const cards = file.cards
				.filter((card) => !finished(card) && card.attempts.length > 0)
				.sort(byRank);
			const facts = await this.facts(cards);
			for (const card of cards) {
				const view = this.view(card, facts, file.cards);
				const reason = inboxReason(latestChatState(view));
				if (reason)
					items.push({ projectId: project.id, projectName: project.name, reason, card: view });
			}
		}
		return { items };
	}

	private async detail(located: Located): Promise<CardDetail> {
		const { projectId, file, card } = located;
		const facts = await this.facts([card]);
		const specs = await this.specsOf(
			card.attempts
				.filter((attempt) => attempt.removedAt === undefined && facts.get(attempt.workspaceId))
				.map((attempt) => attempt.workspaceId),
		);
		const view = this.view(
			card,
			facts,
			file.cards,
			specs,
			this.roadmap.initiativesOf(projectId, [card]),
		);
		const found =
			card.source.kind === "openspec"
				? await this.changeOf(this.openspecReads(this.project(projectId)), card, facts)
				: null;
		return {
			projectId,
			card: found ? { ...view, openspec: overlayOf(found.change, found.snapshot, true) } : view,
			transitions: this.store.transitions(projectId).filter((entry) => entry.cardId === card.id),
		};
	}

	/** The stored card naming an OpenSpec change, by its folder's name or an archived one's base name. */
	private openspecCardOf(projectId: string, name: string): Card | undefined {
		const base = this.openspecSeen.get(projectId)?.get(name)?.baseName ?? name;
		return this.store
			.cards(projectId)
			?.cards.find(
				(card) =>
					card.source.kind === "openspec" &&
					(card.source.change === name || card.source.change === base),
			);
	}

	/** The open repository project holding a workspace. */
	private projectOfWorkspace(workspaceId: string): ExtensionHostProject {
		const project = this.repositories().find((candidate) =>
			candidate.workspaces.some((workspace) => workspace.id === workspaceId),
		);
		if (!project) throw new Error(`No open workspace ${workspaceId}.`);
		return project;
	}

	/** The stored card an attempt holds the workspace for. */
	private cardHolding(projectId: string, workspaceId: string): Located | null {
		const file = this.store.cards(projectId);
		const card = file?.cards.find((candidate) =>
			candidate.attempts.some((attempt) => attempt.workspaceId === workspaceId),
		);
		return file && card ? { projectId, file, card } : null;
	}

	/**
	 * A card with its live overlay, its project and its transitions, for the Peek card. A source's card
	 * that was stored meanwhile (adopted, started, edited) answers as the stored card.
	 */
	async card(id: string, projectId?: string): Promise<CardDetail> {
		const issue = parseIssueCardId(id);
		if (issue !== null) {
			if (!projectId) throw new Error(`Pass the projectId of issue ${id}'s board.`);
			const project = this.project(projectId);
			const stored = this.store
				.cards(project.id)
				?.cards.find((card) => card.source.kind === "github" && card.source.number === issue);
			if (stored) return this.detail(this.locate(stored.id));
			const found = this.issues.issue(project.id, issue);
			if (!found) throw new Error(`GitHub issue ${id} is not on this board; refresh the issues.`);
			return {
				projectId: project.id,
				card: this.issueView(found, this.store.settings(project.id), 0),
				transitions: [],
			};
		}
		const change = parseOpenspecCardId(id);
		if (change !== null) {
			if (!projectId) throw new Error(`Pass the projectId of ${id}'s board.`);
			const project = this.project(projectId);
			const reads = this.openspecReads(project);
			const base = reads.defaultId ? await reads.read(reads.defaultId) : null;
			const stored = this.openspecCardOf(project.id, change);
			if (stored) return this.detail(this.locate(stored.id));
			const found = base ? findChange(base.changes, change) : undefined;
			if (!base || !found) throw new Error(`The OpenSpec change ${change} is not on this board.`);
			return {
				projectId: project.id,
				card: this.openspecView(found, base, this.store.settings(project.id), 0, true),
				transitions: [],
			};
		}
		const spec = parseTaskSpecCardId(id);
		if (spec) {
			const project = this.projectOfWorkspace(spec.workspaceId);
			const held = this.cardHolding(project.id, spec.workspaceId);
			if (held) return this.detail(held);
			const view = (
				await this.taskSpecCards(
					project,
					this.store.cards(project.id)?.cards ?? [],
					this.store.settings(project.id),
					0,
				)
			).find((candidate) => candidate.id === id);
			if (!view) throw new Error(`The task-spec ${spec.specId} is not open in that workspace.`);
			return { projectId: project.id, card: view, transitions: [] };
		}
		return this.detail(this.locate(id));
	}

	/** Writes new stored cards in one go, each with its creation logged. */
	private insert(
		project: ExtensionHostProject,
		drafts: readonly Draft[],
		actor: "human" | "agent",
	): Card[] {
		const file = this.fileFor(project);
		const at = this.now();
		const rank = Math.max(0, ...file.cards.map((other) => other.rank));
		const ids = drafts.map((_, index) => cardId(file.prefix, file.nextNumber + index));
		const number = file.nextNumber + drafts.length;
		const cards = drafts.map((draft, index): Card => {
			const id = cardId(file.prefix, file.nextNumber + index);
			return {
				id,
				source: draft.source ?? { kind: "native", ref: id },
				title: draft.title,
				description: draft.description ?? "",
				acceptance: draft.acceptance ?? [],
				type: draft.type ?? "feature",
				...(draft.size
					? { size: draft.size, ...(draft.sizeSuggested ? { sizeSuggested: true } : {}) }
					: {}),
				labels: draft.labels ?? [],
				blocks: (draft.blocksIndex ?? []).flatMap((position) => ids[position] ?? []),
				specRefs: draft.specRefs ?? [],
				rank: rank + index + 1,
				category: draft.placement.category,
				column: draft.placement.column,
				ownerHuman: this.owner,
				attempts: draft.attempts ?? [],
				createdBy: actor,
				...(draft.origin ? { origin: draft.origin } : {}),
				...(draft.roadmapProjectId ? { roadmapProjectId: draft.roadmapProjectId } : {}),
				createdAt: at,
				updatedAt: at,
			};
		});
		this.write(
			project.id,
			{ ...file, nextNumber: number, cards: [...file.cards, ...cards] },
			cards.map((card, index) => ({
				cardId: card.id,
				from: null,
				to: { category: card.category, column: card.column },
				at,
				actor,
				reason: drafts[index]?.reason ?? "created",
			})),
		);
		for (const card of cards) if (wantsSize(card)) this.sizes.request(card.id);
		return cards;
	}

	createCard(projectId: string, input: CardInput, createdBy: "human" | "agent"): Card {
		const project = this.project(projectId);
		const { preset } = this.store.settings(projectId);
		const placement =
			createdBy === "agent"
				? { category: "triage" as const, column: columnFor(preset, "triage") }
				: input.column !== undefined
					? placeInColumn(preset, { category: "backlog" }, input.column)
					: { category: "backlog" as const, column: columnFor(preset, "backlog") };
		if (!placement) throw new Error(`The board has no column ${input.column}.`);
		const [card] = this.insert(
			project,
			[
				{
					title: input.title,
					...(input.description !== undefined ? { description: input.description } : {}),
					...(input.acceptance ? { acceptance: input.acceptance } : {}),
					...(input.type ? { type: input.type } : {}),
					...(input.size
						? {
								size: input.size,
								...(createdBy === "agent" ? { sizeSuggested: true as const } : {}),
							}
						: {}),
					...(input.labels ? { labels: input.labels } : {}),
					...(input.specRefs ? { specRefs: input.specRefs } : {}),
					...(createdBy === "agent" && input.origin ? { origin: input.origin } : {}),
					placement,
					reason: createdBy === "agent" ? "created by an agent into Triage" : "created",
				},
			],
			createdBy,
		);
		if (!card) throw new Error("The card was not created.");
		return card;
	}

	/**
	 * Files an agent's decomposition into Triage in one write: one origin, so Triage shows it as one group
	 * accepted as a whole, with its `blocks` links among the batch and, given one, its roadmap project.
	 */
	createBatch(
		projectId: string,
		inputs: readonly BatchCardInput[],
		origin: CardOrigin,
		roadmapProjectId?: string,
	): Card[] {
		const project = this.project(projectId);
		if (inputs.length === 0) throw new Error("Pass at least one card.");
		if (roadmapProjectId) this.roadmap.requireProject(projectId, roadmapProjectId);
		const links = new Map<string, string[]>();
		inputs.forEach((input, index) => {
			for (const position of input.blocksIndex ?? []) {
				if (!Number.isInteger(position) || position < 0 || position >= inputs.length)
					throw new Error(`Card ${index}'s blocksIndex ${position} is not a card of this batch.`);
				const from = String(index);
				const to = String(position);
				if (wouldCycle((id) => links.get(id), from, to))
					throw new Error(`Card ${index} blocking card ${position} would close a cycle.`);
				links.set(from, [...(links.get(from) ?? []), to]);
			}
		});
		const { preset } = this.store.settings(projectId);
		return this.insert(
			project,
			inputs.map((input, index) => ({
				title: input.title,
				...(input.description ? { description: input.description } : {}),
				...(input.acceptance ? { acceptance: input.acceptance } : {}),
				...(input.type ? { type: input.type } : {}),
				...(input.size ? { size: input.size, sizeSuggested: true as const } : {}),
				blocksIndex: [...new Set(links.get(String(index)) ?? [])].map(Number),
				...(roadmapProjectId ? { roadmapProjectId } : {}),
				origin,
				placement: { category: "triage", column: columnFor(preset, "triage") },
				reason: "created by an agent into Triage",
			})),
			"agent",
		);
	}

	/** A GitHub issue's stored card, created from the cached issue the first time it is started or edited. */
	private materializeIssue(projectId: string, number: number): Located {
		const project = this.project(projectId);
		const linked = this.store
			.cards(project.id)
			?.cards.find((card) => card.source.kind === "github" && card.source.number === number);
		if (linked) return this.locate(linked.id);
		const issue = this.issues.issue(project.id, number);
		if (!issue)
			throw new Error(`GitHub issue #${number} is not on this board; refresh the issues.`);
		const { preset } = this.store.settings(project.id);
		const [card] = this.insert(
			project,
			[
				{
					title: clip(issue.title, TITLE_MAX),
					source: issueSource(issue),
					description: clip(issue.body, TEXT_MAX),
					type: issueType(issue),
					labels: issue.labels,
					placement: { category: "backlog", column: columnFor(preset, "backlog") },
					reason: `created from GitHub issue #${number}`,
				},
			],
			"human",
		);
		if (!card) throw new Error(`The card of issue #${number} was not created.`);
		return this.locate(card.id);
	}

	/** An OpenSpec change's stored card, created from the last read of Default the first time a write needs it. */
	private materializeOpenspec(projectId: string, name: string): Located {
		const project = this.project(projectId);
		const stored = this.openspecCardOf(project.id, name);
		if (stored) return this.locate(stored.id);
		const change = this.openspecSeen.get(project.id)?.get(name);
		if (!change) throw new Error(`The OpenSpec change ${name} is not on this board; refresh it.`);
		const { preset } = this.store.settings(project.id);
		const category = STAGE_CATEGORIES[stageOf(change)];
		const [card] = this.insert(
			project,
			[
				{
					title: clip(change.title, TITLE_MAX),
					source: { kind: "openspec", ref: change.name, change: change.name },
					description: clip(change.summary, TEXT_MAX),
					placement: { category, column: columnFor(preset, category) },
					reason: `created from the OpenSpec change ${change.name}`,
				},
			],
			"human",
		);
		if (!card) throw new Error(`The card of the OpenSpec change ${name} was not created.`);
		return this.locate(card.id);
	}

	/**
	 * After Apply: the change in the attempt's workspace — carried over from Default when its branch lacks
	 * it (a change proposed and not committed; with `openspec/` missing there, also its config and living
	 * specs) — gets `x-thinkrail { card, workspace }` in its `.openspec.yaml`, every other key kept.
	 */
	private async markApplied(
		projectId: string,
		cardId: string,
		workspaceId: string,
		name: string,
	): Promise<void> {
		const project = this.project(projectId);
		const defaultId = this.defaultWorkspace(project);
		const write = (path: string, content: string) =>
			this.host.actions.writeWorkspaceFile({ workspaceId, path, content });
		const tree = await this.host.openspecTree(workspaceId);
		const active = (files: typeof tree) =>
			files ? parseOpenspec(files).filter((change) => !change.archived) : [];
		let change = findChange(active(tree), name);
		let files = tree;
		if (!change) {
			const base =
				defaultId && defaultId !== workspaceId ? await this.host.openspecTree(defaultId) : null;
			const source = findChange(active(base), name);
			if (!base || !source) throw new Error(`The OpenSpec change ${name} is in neither workspace.`);
			const carried = base.files.filter(
				(file) =>
					file.path.startsWith(`${source.dir}/`) ||
					(!tree &&
						(file.path === "openspec/config.yaml" || file.path.startsWith("openspec/specs/"))),
			);
			for (const file of carried) await write(file.path, file.text);
			change = source;
			files = base;
		}
		const metadataPath = `${change.dir}/.openspec.yaml`;
		const metadata =
			files?.files.find((file) => file.path === metadataPath)?.text ??
			`schema: ${change.error ? SPEC_DRIVEN.name : change.schema}\n`;
		await write(
			metadataPath,
			upsertTopLevelKey(metadata, "x-thinkrail", { card: cardId, workspace: workspaceId }),
		);
	}

	/**
	 * Stores an unbound workspace's task-spec card as a board card bound to that workspace (its attempt
	 * recorded), placed where it showed; a workspace some card already holds answers that card.
	 */
	async adoptTaskSpec(id: string): Promise<Card> {
		const parsed = parseTaskSpecCardId(id);
		if (!parsed) throw new Error(`Not a task-spec's card: ${id}`);
		const { workspaceId, specId } = parsed;
		const project = this.projectOfWorkspace(workspaceId);
		const held = this.cardHolding(project.id, workspaceId);
		if (held) return held.card;
		const [specs, facts] = await Promise.all([
			this.host.taskSpecs(workspaceId),
			this.host.workspaceFacts(workspaceId),
		]);
		const spec = specs?.find((candidate) => candidate.id === specId);
		if (!spec || !facts) throw new Error(`The task-spec ${specId} is not open in that workspace.`);
		const again = this.cardHolding(project.id, workspaceId);
		if (again) return again.card;
		const { preset } = this.store.settings(project.id);
		const category = liveCategory(facts);
		const [card] = this.insert(
			project,
			[
				{
					title: clip(spec.title, TITLE_MAX),
					source: { kind: "task-spec", ref: spec.id, workspaceId, path: spec.path },
					specRefs: [spec.id],
					placement: { category, column: columnFor(preset, category, "implement") },
					attempts: [
						{
							workspaceId,
							sessionId: latestChat(facts)?.sessionId ?? "",
							workflow: "implement",
							startedAt: this.now(),
							notes: [],
						},
					],
					reason: `adopted from the task-spec ${spec.id}`,
				},
			],
			"human",
		);
		if (!card) throw new Error(`The task-spec ${specId} was not adopted.`);
		return card;
	}

	/**
	 * Files the bullets of a card's task-spec's `Deferrals` section into Triage, from the human with the
	 * card as their origin; a bullet already filed from that card is skipped.
	 */
	async sendDeferrals(id: string, specId: string): Promise<{ created: Card[]; skipped: number }> {
		const located = this.locate(id);
		const { card, projectId } = located;
		const ref = (await this.detail(located)).card.taskSpecs.find((spec) => spec.id === specId);
		if (!ref) throw new Error(`${specId} is not a task-spec of ${card.id}'s workspaces.`);
		const section = await this.host.specSection(ref.workspaceId, ref.id, DEFERRALS_HEADING);
		if (section === null) throw new Error(`${ref.id} has no ${DEFERRALS_HEADING} section.`);
		const deferrals = parseDeferrals(section);
		const filed = (this.store.cards(projectId)?.cards ?? []).filter(
			(other) => other.origin?.cardId === card.id,
		);
		const fresh = deferrals.filter(
			(deferral) => !filed.some((other) => sameTitle(other.title, deferral.title)),
		);
		const { preset } = this.store.settings(projectId);
		const created =
			fresh.length === 0
				? []
				: this.insert(
						this.project(projectId),
						fresh.map((deferral) => ({
							title: deferral.title,
							description: deferral.description,
							placement: { category: "triage", column: columnFor(preset, "triage") },
							origin: { cardId: card.id },
							reason: `deferred in the task-spec ${ref.id}`,
						})),
						"human",
					);
		return { created, skipped: deferrals.length - fresh.length };
	}

	private blockTargets(file: CardsFile, card: Card, ids: readonly string[]): string[] {
		const targets = new Set<string>();
		for (const raw of ids) {
			const parsed = parseCardId(raw);
			const id = parsed ? cardId(parsed.prefix, parsed.number) : raw;
			if (id === card.id) throw new Error(`${card.id} cannot block itself.`);
			if (!file.cards.some((other) => other.id === id))
				throw new Error(`${id} is not a card of ${card.id}'s board.`);
			const blocksOf = (other: string) =>
				file.cards.find((candidate) => candidate.id === other)?.blocks;
			if (wouldCycle(blocksOf, card.id, id))
				throw new Error(
					`${card.id} blocking ${id} would close a cycle: ${id} already leads to it.`,
				);
			targets.add(id);
		}
		return [...targets];
	}

	updateCard(id: string, patch: CardPatch, projectId?: string): Card {
		const { projectId: owner, file, card } = this.writable(id, projectId);
		const { size, cancelPending, blocks, estimateDays, ...fields } = patch;
		const next: Card = { ...card, ...fields, updatedAt: this.now() };
		if (estimateDays === null) delete next.estimateDays;
		else if (estimateDays !== undefined) next.estimateDays = estimateDays;
		if (size !== undefined) {
			delete next.size;
			delete next.sizeSuggested;
			if (size !== null) next.size = size;
		}
		if (blocks !== undefined) next.blocks = this.blockTargets(file, card, blocks);
		if (cancelPending === false) delete next.cancelPending;
		this.write(owner, this.replace(file, next), []);
		const reworded = (["title", "description", "acceptance", "type"] as const).some(
			(key) => fields[key] !== undefined,
		);
		if (size === undefined && reworded && wantsSize(next)) this.sizes.request(next.id);
		return next;
	}

	moveCard(id: string, column: string, rank?: number, projectId?: string): Card {
		const { projectId: owner, file, card } = this.writable(id, projectId);
		const result = moveByHand(card, column, this.store.settings(owner).preset, this.now(), rank);
		if (!result) throw new Error(`The board has no column ${column}.`);
		this.write(
			owner,
			this.replace(file, result.card),
			result.transition ? [result.transition] : [],
		);
		return result.card;
	}

	deleteCard(id: string): { deleted: string } {
		if (parseIssueCardId(id) !== null)
			throw new Error("A GitHub issue's card stays while the issue is open; close it on GitHub.");
		if (parseTaskSpecCardId(id))
			throw new Error("A task-spec's card stays while its workspace is open.");
		if (parseOpenspecCardId(id) !== null)
			throw new Error("An OpenSpec change's card stays while its change folder is there.");
		const { projectId, file, card } = this.locate(id);
		this.roadmap.forgetCard(projectId, card.id);
		const cards = file.cards
			.filter((candidate) => candidate.id !== card.id)
			.map((candidate) =>
				candidate.blocks.includes(card.id)
					? { ...candidate, blocks: candidate.blocks.filter((other) => other !== card.id) }
					: candidate,
			);
		this.write(projectId, { ...file, cards }, [
			{
				cardId: card.id,
				from: { category: card.category, column: card.column },
				to: null,
				at: this.now(),
				actor: "human",
				reason: "deleted",
			},
		]);
		return { deleted: card.id };
	}

	/** Accepts a decomposition as a whole: every card must be in Triage on one board, or nothing moves. */
	acceptTriage(ids: readonly string[]): Card[] {
		const located = ids.map((id) => this.locate(id));
		const [first] = located;
		if (!first) throw new Error("Name the Triage cards to accept.");
		if (located.some((entry) => entry.projectId !== first.projectId))
			throw new Error("Accept the Triage cards of one board at a time.");
		const notTriage = located.filter((entry) => entry.card.category !== "triage");
		if (notTriage.length > 0)
			throw new Error(`Not in Triage: ${notTriage.map((entry) => entry.card.id).join(", ")}.`);
		const { preset } = this.store.settings(first.projectId);
		const at = this.now();
		const to = { category: "backlog" as Category, column: columnFor(preset, "backlog") };
		const accepted = new Map(
			located.map(({ card }) => [card.id, { ...card, ...to, updatedAt: at }] as const),
		);
		const file = this.store.cards(first.projectId) ?? first.file;
		this.write(
			first.projectId,
			{ ...file, cards: file.cards.map((card) => accepted.get(card.id) ?? card) },
			located.map(({ card }) => ({
				cardId: card.id,
				from: { category: card.category, column: card.column },
				to,
				at,
				actor: "human" as const,
				reason: "accepted from Triage",
			})),
		);
		return [...accepted.values()];
	}

	/**
	 * A roadmap chat (plan, shape, report or review) in a new chat of the project's Default workspace: the
	 * kickoff names its skill and carries the initiative's text and the instructions, so it works without it.
	 */
	async startRoadmapChat(
		projectId: string,
		kind: RoadmapChat,
		initiativeId?: string,
	): Promise<StartedChat> {
		const project = this.project(projectId);
		const { initiatives } = this.store.initiatives(projectId);
		const initiative = initiativeId
			? initiatives.find((candidate) => candidate.id === initiativeId)
			: undefined;
		if (initiativeId && !initiative)
			throw new Error(`No initiative ${initiativeId} on this board.`);
		if (kind !== "review" && !initiative) throw new Error(`Pass the initiativeId to ${kind}.`);
		if (kind === "close" && initiative?.closedAt !== undefined)
			throw new Error(`${initiative.id} is already closed.`);
		return this.chatInDefault(
			project,
			roadmapKickoff(kind, {
				board: project.name,
				...(initiative ? { initiative } : {}),
				initiatives,
			}),
		);
	}

	/** A new chat in the project's Default workspace on `kickoff`, as the roadmap and discovery chats start. */
	private async chatInDefault(
		project: ExtensionHostProject,
		kickoff: string,
	): Promise<StartedChat> {
		const workspaceId = this.defaultWorkspace(project);
		if (!workspaceId) throw new Error(`${project.name} has no Default workspace open.`);
		const started = await this.host.actions.startChat({ workspaceId, kickoff: { text: kickoff } });
		return {
			projectId: project.id,
			workspaceId: started.workspaceId,
			sessionId: started.sessionId,
			kickoff,
			...(started.kickoffError ? { kickoffError: started.kickoffError } : {}),
		};
	}

	/**
	 * Promote: a Shape chat whose kickoff carries the idea; the agent's `board_initiative_create_draft` with
	 * its `ideaId` links the idea to the initiative it proposes.
	 */
	async promoteIdea(projectId: string, ideaId: string): Promise<StartedChat> {
		const project = this.project(projectId);
		const idea = this.discovery.promotable(projectId, ideaId);
		return this.chatInDefault(
			project,
			roadmapKickoff("shape", {
				board: project.name,
				idea,
				initiatives: this.store.initiatives(projectId).initiatives,
			}),
		);
	}

	/** A discovery chat: research or analyze an idea, or ask the watchlist (or one entry) what changed. */
	async startDiscoveryChat(
		projectId: string,
		kind: DiscoveryChat,
		target: { ideaId?: string; watchId?: string },
	): Promise<StartedChat> {
		const project = this.project(projectId);
		const idea = target.ideaId ? this.discovery.idea(projectId, target.ideaId) : undefined;
		if (kind !== "watch" && !idea) throw new Error(`Pass the ideaId to ${kind}.`);
		const watchId = target.watchId
			? this.discovery.watchEntry(projectId, target.watchId).id
			: undefined;
		const { entries } = this.store.watchlist(projectId);
		if (kind === "watch" && entries.length === 0)
			throw new Error("The watchlist is empty; add a competitor first.");
		return this.chatInDefault(
			project,
			discoveryKickoff(kind, {
				board: project.name,
				today: isoOfDay(today(this.now())),
				...(kind !== "watch" && idea ? { idea } : {}),
				...(kind === "watch" ? { entries, ...(watchId ? { watchId } : {}) } : {}),
			}),
		);
	}

	/**
	 * Writes the roadmap snapshot (`snapshot.ts`) into the project's Default workspace through the host's
	 * `writeWorkspaceFile`, at `path` or the settings' `snapshotPath`; a new path is remembered.
	 */
	async publishSnapshot(
		projectId: string,
		path?: string,
	): Promise<{ projectId: string; workspaceId: string; path: string; bytes: number }> {
		const project = this.project(projectId);
		const workspaceId = this.defaultWorkspace(project);
		if (!workspaceId) throw new Error(`${project.name} has no Default workspace open.`);
		const settings = this.store.settings(projectId);
		const view = await this.roadmap.get(projectId);
		const written = await this.host.actions.writeWorkspaceFile({
			workspaceId,
			path: path ?? settings.snapshotPath,
			content: roadmapSnapshot(view, isoOfDay(today(this.now()))),
		});
		if (written.path !== settings.snapshotPath) {
			this.store.saveSettings(projectId, { ...settings, snapshotPath: written.path });
			this.changed(projectId);
		}
		return { projectId, workspaceId, path: written.path, bytes: written.bytes };
	}

	/**
	 * The deferrals the task-specs of these cards' open workspaces list (their `Deferrals` sections), each
	 * card's once, minus those whose title a card of the board already has.
	 */
	async deferralsOf(projectId: string, cardIds: readonly string[]): Promise<CardDeferrals[]> {
		const all = this.store.cards(projectId)?.cards ?? [];
		const wanted = new Set(cardIds);
		const cards = all.filter((card) => wanted.has(card.id));
		const specs = await this.specsOf(
			cards.flatMap((card) =>
				card.attempts
					.filter((attempt) => attempt.removedAt === undefined)
					.map((attempt) => attempt.workspaceId),
			),
		);
		const found: CardDeferrals[] = [];
		for (const card of cards)
			for (const ref of this.taskSpecsOn(card, specs)) {
				const section = await this.host
					.specSection(ref.workspaceId, ref.id, DEFERRALS_HEADING)
					.catch(() => null);
				if (section === null) continue;
				const deferrals = parseDeferrals(section).filter(
					(deferral) => !all.some((other) => sameTitle(other.title, deferral.title)),
				);
				if (deferrals.length > 0) found.push({ cardId: card.id, specId: ref.id, deferrals });
			}
		return found;
	}

	/** Starts an attempt: a new workspace whose chat takes the card's kickoff; the card moves to started. */
	async startCard(
		id: string,
		options: StartOptions = {},
		projectId?: string,
	): Promise<{ card: Card; attempt: Attempt; kickoffError?: string }> {
		const { projectId: owner, card } = this.writable(id, projectId);
		if (card.category === "triage")
			throw new Error(`Accept ${card.id} from Triage before starting it.`);
		if (this.starting.has(card.id)) throw new Error(`${card.id} is already starting.`);
		const change = card.source.kind === "openspec" ? card.source.change : null;
		if (change !== null) {
			const seen = this.openspecSeen.get(owner);
			const found = seen ? findChange([...seen.values()], change) : undefined;
			if (found && (found.archived || found.tasks.total === 0))
				throw new Error(
					found.archived
						? `${change} is archived; there is nothing left to apply.`
						: `${change} has no tasks yet; finish its artifacts before applying it.`,
				);
		}
		const workflow = change !== null ? "implement" : (options.workflow ?? workflowFor(card));
		const context = {
			...this.roadmap.kickoffContext(owner, card),
			...(options.note ? { note: options.note } : {}),
		};
		const into = options.into ?? this.initiativeContainer(owner, card);
		this.starting.add(card.id);
		try {
			const created = await this.host.actions.createWorkspace({
				projectId: owner,
				...(options.baseRef ? { baseRef: options.baseRef } : {}),
				...(into ? { into } : {}),
				kickoff: {
					text:
						change !== null
							? openspecApplyKickoff(card, change, context)
							: kickoffText(card, workflow, context),
					...(options.model ? { model: options.model } : {}),
					...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
				},
			});
			let latest: Located;
			try {
				latest = this.locate(card.id);
			} catch {
				throw new Error(
					`${card.id} was deleted while its workspace ${created.workspaceId} was starting.`,
				);
			}
			const at = this.now();
			const attempt: Attempt = {
				workspaceId: created.workspaceId,
				sessionId: created.sessionId,
				workflow,
				startedAt: at,
				notes: [],
			};
			const withAttempt: Card = {
				...latest.card,
				attempts: [...latest.card.attempts, attempt],
				updatedAt: at,
			};
			const result = applyEvent(
				withAttempt,
				{
					kind: "started",
					workspaceId: attempt.workspaceId,
					workflow,
					...(options.reason ? { reason: options.reason } : {}),
				},
				this.store.settings(owner).preset,
				at,
			);
			const next = result?.card ?? withAttempt;
			this.write(
				owner,
				this.replace(latest.file, next),
				result?.transition ? [result.transition] : [],
			);
			let openspecError: string | undefined;
			if (change !== null)
				await this.markApplied(owner, card.id, created.workspaceId, change).catch((error) => {
					openspecError = error instanceof Error ? error.message : String(error);
					this.host.log.warn(`marking ${change} applied in ${created.workspaceId} failed`, error);
				});
			return {
				card: next,
				attempt,
				...(created.kickoffError ? { kickoffError: created.kickoffError } : {}),
				...(openspecError ? { openspecError } : {}),
			};
		} finally {
			this.starting.delete(card.id);
		}
	}

	/** The container of the initiative a card serves, while that container exists. */
	private initiativeContainer(projectId: string, card: Card): string | undefined {
		const containerId = this.roadmap.initiativeOfCard(projectId, card)?.initiative.containerId;
		if (!containerId) return undefined;
		return this.host.containers().some((container) => container.id === containerId)
			? containerId
			: undefined;
	}

	/** An initiative's cards as autopilot's selection reads them, and its board's WIP. */
	async pilotInputs(
		projectId: string,
		initiative: Initiative,
	): Promise<{ cards: PilotCard[]; wip: PilotWip }> {
		const cards = this.store.cards(projectId)?.cards ?? [];
		const members = this.roadmap.members(projectId, initiative.id);
		const facts = await this.facts([
			...cards,
			...members.filter((member) => member.projectId !== projectId).map((member) => member.card),
		]);
		const wip = wipOf(
			cards.map((card) => this.view(card, facts, cards)),
			this.store.settings(projectId).wipLimits,
		);
		return {
			wip,
			cards: members.map(({ file, card }) => ({
				id: card.id,
				title: card.title,
				category: card.category,
				...(card.size ? { size: card.size } : {}),
				type: card.type,
				rank: card.rank,
				active: this.starting.has(card.id) || openAttemptOf(card, facts) !== undefined,
				blockers: file.cards
					.filter((other) => other.blocks.includes(card.id))
					.map((other) => ({ id: other.id, category: other.category })),
			})),
		};
	}

	/**
	 * Run initiative: the initiative's container — made around its first ready card, started like Start
	 * (logged `automation`), or the one it has —, its orchestrator started and woken with a `board-run`
	 * brief of the initiative's outcome, criteria and autopilot.
	 */
	async runInitiative(projectId: string, initiativeId: string): Promise<RunResult> {
		const project = this.project(projectId);
		const initiative = this.roadmap.initiativeById(projectId, initiativeId);
		if (initiative.proposed)
			throw new Error(`${initiative.id} is a proposal; accept it before running it.`);
		if (initiative.closedAt !== undefined) throw new Error(`${initiative.id} is closed.`);
		const existing = initiative.containerId
			? this.host.containers().find((container) => container.id === initiative.containerId)
			: undefined;
		const { cards, wip } = await this.pilotInputs(projectId, initiative);
		let containerId = existing?.id;
		let started: RunResult["started"] = null;
		let first: PilotCard | undefined;
		if (!containerId) {
			const selection = select(cards, wip, { orchestrator: true });
			if (selection.pause) throw new Error(pauseRefusal(selection.pause, initiative.id));
			first = selection.selected[0];
			if (!first) throw new Error(nothingToRun(initiative.id, cards, selection.ready.length));
			const result = await this.startCard(first.id, {
				reason: `started by Run initiative ${initiative.id}`,
			});
			started = {
				cardId: result.card.id,
				workspaceId: result.attempt.workspaceId,
				sessionId: result.attempt.sessionId,
				...(result.kickoffError ? { kickoffError: result.kickoffError } : {}),
			};
			const container = await this.host.actions.createContainer({
				name: initiative.title,
				workspaceIds: [result.attempt.workspaceId],
			});
			containerId = container.id;
			this.roadmap.setContainer(projectId, initiative.id, container.id);
		}
		const orchestrator = await this.host.actions.startOrchestrator({ containerId });
		const latest = this.roadmap.initiativeById(projectId, initiative.id);
		await this.host.actions.wakeOrchestrator({
			containerId,
			kind: WAKE_RUN,
			text: runBrief({
				initiative: latest,
				boardName: project.name,
				started: first ?? null,
				autopilot: latest.autopilot?.on === true,
				running: wip.agents.count + (first ? 1 : 0),
				cap: wip.agents.limit,
			}),
		});
		this.autopilot.schedule();
		return {
			projectId,
			initiativeId: initiative.id,
			containerId,
			orchestrator: {
				projectId: orchestrator.projectId,
				workspaceId: orchestrator.workspaceId,
				sessionId: orchestrator.sessionId,
			},
			started,
		};
	}

	/** The autopilot switch: on needs the initiative's container; off forgets its offers. */
	setAutopilot(projectId: string, initiativeId: string, on: boolean): Initiative {
		this.project(projectId);
		const initiative = this.roadmap.initiativeById(projectId, initiativeId);
		if (on && !initiative.containerId)
			throw new Error(
				`Run ${initiative.id} first: autopilot wakes the orchestrator of its container.`,
			);
		const next = this.roadmap.setAutopilot(
			projectId,
			initiative.id,
			on ? { ...initiative.autopilot, on: true } : { on: false },
		);
		if (!on) this.autopilot.forget(projectId, initiative.id);
		this.autopilot.schedule();
		return next;
	}

	/** `autopilot.get`: an initiative's autopilot now — on, paused with why, or off — and its room. */
	async autopilotView(projectId: string, initiativeId: string): Promise<AutopilotView> {
		this.project(projectId);
		return this.autopilot.view(projectId, this.roadmap.initiativeById(projectId, initiativeId));
	}

	/** The initiative a container runs, with its autopilot; `null` for a container no initiative ran. */
	async containerAutopilot(containerId: string): Promise<AutopilotView | null> {
		const [linked] = this.roadmap.ofContainer(containerId);
		return linked ? this.autopilot.view(linked.projectId, linked.initiative) : null;
	}

	/** The container a chat works in: the one it orchestrates, else the one its workspace is a member of. */
	callerContainer(sessionId: string, cwd: string): ExtensionContainer | null {
		const containers = this.host.containers();
		const own = containers.find((container) => container.orchestrator?.sessionId === sessionId);
		if (own) return own;
		const workspaceId = this.host.sessionScope({ kind: "all" }).locate(cwd)?.workspaceId;
		return (
			(workspaceId
				? containers.find((container) => container.workspaceIds.includes(workspaceId))
				: undefined) ?? null
		);
	}

	/** The orchestrator's system-prompt section while its container runs an initiative; `null` otherwise. */
	orchestratorRule(sessionId: string): string | null {
		const container = this.host
			.containers()
			.find((candidate) => candidate.orchestrator?.sessionId === sessionId);
		const linked = container ? this.roadmap.ofContainer(container.id) : [];
		return linked.length > 0 ? autopilotRule(linked.map((entry) => entry.initiative)) : null;
	}

	/**
	 * `board_card_start`: a ready, unblocked card of an initiative the caller's container runs, started into
	 * that container like Start, the note appended to its kickoff and the start logged `automation`.
	 */
	async startForContainer(
		sessionId: string,
		cwd: string,
		id: string,
		options: { workflow?: Workflow; note?: string },
	): Promise<{
		card: Card;
		attempt: Attempt;
		kickoffError?: string;
		container: ExtensionContainer;
	}> {
		const container = this.callerContainer(sessionId, cwd);
		if (!container)
			throw new Error(
				"board_card_start starts cards from a container's orchestrator (or a chat of one of its workspaces); this chat is in no container.",
			);
		const linked = this.roadmap.ofContainer(container.id);
		if (linked.length === 0)
			throw new Error(
				`The container "${container.name}" runs no initiative: Run one from the board's initiative panel first.`,
			);
		const card = this.locate(id).card;
		const owner = linked.find(({ projectId, initiative }) =>
			this.roadmap.members(projectId, initiative.id).some((member) => member.card.id === card.id),
		);
		if (!owner) {
			const names = linked
				.map(({ initiative }) => `${initiative.id} "${initiative.title}"`)
				.join(", ");
			throw new Error(
				`${card.id} is not a card of ${names}, which the container "${container.name}" runs; board_card_start starts only that initiative's cards.`,
			);
		}
		const { cards } = await this.pilotInputs(owner.projectId, owner.initiative);
		const pilot = cards.find((candidate) => candidate.id === card.id);
		const reason = pilot ? unready(pilot, { sized: false }) : null;
		if (reason) throw new Error(unreadyRefusal(card.id, reason));
		const note = options.note?.trim();
		const from = `the orchestrator of the container "${container.name}"`;
		const result = await this.startCard(card.id, {
			...(options.workflow ? { workflow: options.workflow } : {}),
			...(note ? { note: { from, text: note } } : {}),
			into: container.id,
			reason: `started by ${from}`,
		});
		return { ...result, container };
	}

	/** A change card's action target: its stored card (`openspec:<name>` names one once stored) and its change. */
	/** A stored card's latest attempt and its workspace's facts (`null` once it is gone). */
	private async latestAttempt(
		id: string,
	): Promise<{ located: Located; attempt: Attempt; facts: ExtensionWorkspaceFacts | null }> {
		const located = this.locate(id);
		const attempt = located.card.attempts.at(-1);
		if (!attempt) throw new Error(`${located.card.id} has no attempt yet; start it first.`);
		const facts =
			attempt.removedAt === undefined
				? await this.host.workspaceFacts(attempt.workspaceId).catch(() => null)
				: null;
		return { located, attempt, facts };
	}

	/** What a card asks for: its criteria, its workspace's task-specs' Product bullets, its change's deltas. */
	private async requirementsOf(
		located: Located,
		attempt: Attempt,
		facts: ExtensionWorkspaceFacts,
	): Promise<Requirement[]> {
		const { card, projectId } = located;
		const specs = ((await this.host.taskSpecs(attempt.workspaceId).catch(() => null)) ?? []).filter(
			(spec) => spec.status !== "deprecated",
		);
		const products = await Promise.all(
			specs.map(async (spec) => ({
				specId: spec.id,
				section:
					(await this.host
						.specSection(attempt.workspaceId, spec.id, PRODUCT_HEADING)
						.catch(() => null)) ?? "",
			})),
		);
		const found =
			card.source.kind === "openspec"
				? await this.changeOf(
						this.openspecReads(this.project(projectId)),
						card,
						new Map([[attempt.workspaceId, facts]]),
					)
				: null;
		return assembleRequirements({
			acceptance: card.acceptance,
			products: products.filter((product) => product.section.trim()),
			openspec: found?.change.requirements ?? [],
		}).slice(0, REVIEW_REQUIREMENTS_MAX);
	}

	private servedBy(projectId: string, card: Card): Packet["why"]["initiative"] {
		const served = this.roadmap.initiativesOf(projectId, [card]).get(card.id)?.initiative;
		return served ? { id: served.id, title: served.title, outcome: served.outcome } : undefined;
	}

	/**
	 * Starts a smart review of the card's latest attempt and answers at once: plan review's independent
	 * reviewer checks the workspace's change against the card's requirements, the verdicts land on the
	 * attempt (`review`), each unmet item with a line becomes a Review comment, and `board.changed` says so.
	 * The card reads `reviewing` meanwhile and `reviewError` after a failure.
	 */
	async reviewCard(id: string): Promise<{ cardId: string; requirements: number }> {
		const { located, attempt, facts } = await this.latestAttempt(id);
		const { card, projectId } = located;
		if (!facts) throw new Error(`${card.id}'s latest workspace is not open.`);
		if (this.reviewing.has(card.id)) throw new Error(`${card.id} is being reviewed already.`);
		const requirements = await this.requirementsOf(located, attempt, facts);
		if (requirements.length === 0)
			throw new Error(`${card.id} has nothing to check yet: add acceptance criteria first.`);
		if (this.reviewing.has(card.id)) throw new Error(`${card.id} is being reviewed already.`);
		this.reviewFailures.delete(card.id);
		const run = this.runReview(located, attempt, requirements)
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				this.reviewFailures.set(card.id, message);
				this.host.log.warn(`the smart review of ${card.id} failed: ${message}`);
			})
			.finally(() => {
				this.reviewing.delete(card.id);
				this.changed(projectId);
			});
		this.reviewing.set(card.id, run);
		this.changed(projectId);
		return { cardId: card.id, requirements: requirements.length };
	}

	private async runReview(
		located: Located,
		attempt: Attempt,
		requirements: readonly Requirement[],
	): Promise<void> {
		const { card, projectId } = located;
		const initiative = this.servedBy(projectId, card);
		const context = [
			`Card ${card.id}: ${card.title}`,
			card.description.trim(),
			initiative
				? `It serves initiative ${initiative.id}: ${initiative.title} — ${initiative.outcome}`
				: "",
		]
			.filter(Boolean)
			.join("\n\n");
		const result = await this.host.actions.reviewConformance({
			workspaceId: attempt.workspaceId,
			...(attempt.sessionId ? { sessionId: attempt.sessionId } : {}),
			requirements: requirements.map(({ id, text, scenarios }) => ({
				id,
				text,
				...(scenarios ? { scenarios } : {}),
			})),
			context,
		});
		const previous = new Map(
			(attempt.review?.items ?? []).flatMap((item) =>
				item.verdict === "unmet" && item.commentId ? [[item.id, item.commentId] as const] : [],
			),
		);
		const items = reviewItems(requirements, result);
		const wanted = unmetComments(items).filter((entry) => !previous.has(entry.itemId));
		const filed = new Map(previous);
		if (wanted.length > 0) {
			const { comments } = await this.host.actions.addReviewComments({
				workspaceId: attempt.workspaceId,
				author: SMART_REVIEW_AUTHOR,
				comments: wanted.map((entry) => entry.comment),
			});
			comments.forEach((comment, index) => {
				const itemId = wanted[index]?.itemId;
				if (itemId) filed.set(itemId, comment.id);
			});
		}
		const review: AttemptReview = {
			at: this.now(),
			summary: result.summary,
			items: items.map((item) => {
				const commentId = item.verdict === "unmet" ? filed.get(item.id) : undefined;
				return commentId ? { ...item, commentId } : item;
			}),
		};
		const latest = this.locate(card.id);
		this.write(
			projectId,
			this.replace(latest.file, {
				...latest.card,
				attempts: latest.card.attempts.map((candidate) =>
					candidate.workspaceId === attempt.workspaceId ? { ...candidate, review } : candidate,
				),
			}),
			[],
		);
	}

	/**
	 * The card's review packet from host facts: why (the initiative's outcome, the card's goal), what (the
	 * latest attempt's plan steps), how it was verified (their verifications), how it conforms (the stored
	 * review), the time split from the log and the diff.
	 */
	async packet(id: string): Promise<Packet> {
		const { located, attempt, facts } = await this.latestAttempt(id);
		const { card, projectId } = located;
		const sessionId = attemptChat(attempt, facts)?.sessionId ?? attempt.sessionId;
		const plan =
			facts && sessionId
				? await this.host.planSummary(attempt.workspaceId, sessionId).catch(() => null)
				: null;
		const initiative = this.servedBy(projectId, card);
		return packetOf({
			card,
			...(initiative ? { initiative } : {}),
			plan,
			review: attempt.review,
			diff: facts?.diff ?? null,
			time: timeSplit(
				this.store.transitions(projectId).filter((entry) => entry.cardId === card.id),
				this.now(),
			),
		});
	}

	/**
	 * Upserts the packet as the `## Review packet` section of the latest attempt's PR description through
	 * the user's `gh` — between its markers only, nothing else of the body, and no edit when it is already
	 * there. Refused without a pull request.
	 */
	async packetToPr(
		id: string,
	): Promise<{ cardId: string; pr: number; url?: string; updated: boolean }> {
		const { located, attempt, facts } = await this.latestAttempt(id);
		const { card, projectId } = located;
		const pr = facts?.review;
		if (pr?.kind !== "pull-request")
			throw new Error(`${card.id}'s workspace has no pull request; open one first.`);
		const { markdown } = await this.packet(card.id);
		const run = (argv: string[]) =>
			this.host.actions.runInWorkspace({
				workspaceId: attempt.workspaceId,
				argv,
				timeoutMs: GH_TIMEOUT_MS,
			});
		const viewed = await run(["gh", "pr", "view", String(pr.number), "--json", "body"]);
		if (!viewed.ok) throw new Error(runError(viewed, "gh pr view"));
		const body = parsePrBody(viewed.out);
		if (body === null) throw new Error("gh pr view answered no description.");
		const next = upsertPacket(body, markdown);
		const answer = { cardId: card.id, pr: pr.number, ...(pr.url ? { url: pr.url } : {}) };
		if (next === body) return { ...answer, updated: false };
		const path = this.store.writeScratch(projectId, `pr-${pr.number}-packet.md`, next);
		try {
			const edited = await run(["gh", "pr", "edit", String(pr.number), "--body-file", path]);
			if (!edited.ok) throw new Error(runError(edited, "gh pr edit"));
		} finally {
			this.store.removeScratch(path);
		}
		return { ...answer, updated: true };
	}

	private async changeForAction(
		id: string,
		projectId?: string,
	): Promise<{
		reads: OpenspecReads;
		card: Card | null;
		found: { change: OpenspecChange; snapshot: OpenspecSnapshot } | null;
	}> {
		const name = parseOpenspecCardId(id);
		const located = name === null ? this.locate(id) : null;
		const project = this.project(located?.projectId ?? projectId ?? "");
		const reads = this.openspecReads(project);
		const base = reads.defaultId ? await reads.read(reads.defaultId) : null;
		const card =
			located?.card ?? (name !== null ? this.openspecCardOf(project.id, name) : null) ?? null;
		if (card && card.source.kind !== "openspec")
			throw new Error(`${card.id} is not an OpenSpec change's card.`);
		if (card)
			return { reads, card, found: await this.changeOf(reads, card, await this.facts([card])) };
		const change = base && name !== null ? findChange(base.changes, name) : undefined;
		return { reads, card: null, found: base && change ? { change, snapshot: base } : null };
	}

	/** `openspec validate <change> --strict --json` through the user's CLI, where the card reads its change. */
	async validateChange(id: string, projectId?: string): Promise<ChangeValidation> {
		const { reads, found } = await this.changeForAction(id, projectId);
		if (!reads.cli().version) throw new Error(INSTALL_OPENSPEC);
		if (!found) throw new Error(`The OpenSpec change of ${id} is not in its workspace.`);
		if (found.change.archived)
			throw new Error(`${found.change.name} is archived; validate checks active changes.`);
		const verdict = await this.openspec.validate(found.snapshot.workspaceId, found.change.name);
		if (!verdict)
			throw new Error(`openspec validate answered no verdict for ${found.change.name}.`);
		return { change: found.change.name, workspaceId: found.snapshot.workspaceId, ...verdict };
	}

	/**
	 * "Archive in workspace": asks the agent of the card's apply workspace, in its chat, to run
	 * openspec-archive-change and update the PR — the archive lands in that workspace before the merge.
	 */
	async archiveChange(
		id: string,
		projectId?: string,
	): Promise<{ cardId: string; workspaceId: string; sessionId: string; text: string }> {
		const { reads, card, found } = await this.changeForAction(id, projectId);
		if (card?.source.kind !== "openspec")
			throw new Error("Apply the change first: it is archived in its apply workspace.");
		if (!reads.cli().version) throw new Error(INSTALL_OPENSPEC);
		const facts = await this.facts([card]);
		const attempt = openAttemptOf(card, facts);
		const chat = attempt ? attemptChat(attempt, facts.get(attempt.workspaceId) ?? null) : undefined;
		if (!attempt || !chat) throw new Error(`${card.id} has no open workspace with a chat to ask.`);
		if (found?.change.archived) throw new Error(`${found.change.name} is already archived there.`);
		const text = openspecArchiveMessage(found?.change.name ?? card.source.change);
		await this.host.actions.sendToChat({ sessionId: chat.sessionId, text, mode: "follow_up" });
		return { cardId: card.id, workspaceId: attempt.workspaceId, sessionId: chat.sessionId, text };
	}

	/** "＋ Propose change": a new chat in the Default workspace on `/skill:openspec-propose` and the description. */
	async proposeChange(projectId: string, description: string): Promise<StartedChat> {
		return this.chatInDefault(this.project(projectId), openspecProposeKickoff(description));
	}

	settings(projectId: string): BoardSettings {
		this.project(projectId);
		return this.store.settings(projectId);
	}

	updateSettings(projectId: string, patch: SettingsPatch): BoardSettings {
		this.project(projectId);
		const current = this.store.settings(projectId);
		const next: BoardSettings = {
			...current,
			preset: patch.preset ?? current.preset,
			wipLimits: { ...current.wipLimits, ...patch.wipLimits },
			followSelection: patch.followSelection ?? current.followSelection,
		};
		this.store.saveSettings(projectId, next);
		const file = this.store.cards(projectId);
		if (file && next.preset !== current.preset) {
			const cards = file.cards.map((card) => ({
				...card,
				column: columnOfCard(next.preset, card),
			}));
			this.write(projectId, { ...file, cards }, []);
		} else this.changed(projectId);
		return next;
	}

	/**
	 * Switches the GitHub source or its filter. Switching it on first asks the host whether the user's
	 * `gh` can run; a problem answers without changing anything, for the web half to explain.
	 */
	async setGithub(
		projectId: string,
		patch: Partial<GithubSettings>,
	): Promise<{ settings: BoardSettings; problem: GhSetupProblem | null }> {
		const project = this.project(projectId);
		const current = this.store.settings(projectId);
		if (patch.enabled === true && !current.github.enabled) {
			const problem = await this.host.githubProblem();
			if (problem) return { settings: current, problem };
		}
		const next: BoardSettings = { ...current, github: { ...current.github, ...patch } };
		this.store.saveSettings(projectId, next);
		if (!next.github.enabled) this.issues.forget(projectId);
		else this.issues.read(projectId, this.defaultWorkspace(project), next.github.filter);
		this.changed(projectId);
		return { settings: next, problem: null };
	}

	/** Fetches the project's issues now (the board's Refresh) and answers the source's state. */
	async refreshIssues(projectId: string): Promise<GithubStatus> {
		const project = this.project(projectId);
		const { github } = this.store.settings(projectId);
		if (!github.enabled) throw new Error("GitHub issues are off on this board.");
		await this.issues.refresh(projectId, this.defaultWorkspace(project), github.filter);
		return this.githubStatus(projectId, github);
	}

	/**
	 * A chat's board: its workspace's project, else — for a container's orchestrator, whose home is no
	 * project — the board of the initiative its container runs.
	 */
	projectOfChat(sessionId: string, cwd: string): ExtensionHostProject {
		try {
			return this.projectOfCwd(cwd);
		} catch (error) {
			const container = this.callerContainer(sessionId, cwd);
			const [linked] = container ? this.roadmap.ofContainer(container.id) : [];
			if (!linked) throw error;
			return this.project(linked.projectId);
		}
	}

	/** The open repository project holding a session cwd. */
	projectOfCwd(cwd: string): ExtensionHostProject {
		const placement = this.host.sessionScope({ kind: "all" }).locate(cwd);
		const project = this.repositories().find((candidate) => candidate.id === placement?.projectId);
		if (!project)
			throw new Error("This chat is not in a workspace of an open project, so it has no board.");
		return project;
	}

	/** The card a chat works on: the attempt that started it, else the attempt of its workspace. */
	cardOfSession(sessionId: string, cwd: string): Located | null {
		for (const projectId of this.store.projectIds()) {
			const file = this.safeCards(projectId);
			const card = file?.cards.find((candidate) =>
				candidate.attempts.some((attempt) => attempt.sessionId === sessionId),
			);
			if (file && card) return { projectId, file, card };
		}
		const workspaceId = this.host.sessionScope({ kind: "all" }).locate(cwd)?.workspaceId;
		const bound = workspaceId ? this.bound(workspaceId) : undefined;
		if (!bound) return null;
		const file = this.safeCards(bound.projectId);
		const card = file?.cards.find((candidate) => candidate.id === bound.cardId);
		return file && card ? { projectId: bound.projectId, file, card } : null;
	}

	cards(projectId: string, category?: Category): Card[] {
		this.project(projectId);
		return [...(this.store.cards(projectId)?.cards ?? [])]
			.filter((card) => category === undefined || card.category === category)
			.sort(byRank);
	}

	find(id: string): Card {
		return this.locate(id).card;
	}

	link(id: string, blocks: readonly string[]): Card {
		const { file, card } = this.locate(id);
		const added = this.blockTargets(file, card, blocks);
		return this.updateCard(card.id, { blocks: [...new Set([...card.blocks, ...added])] });
	}

	/** Removes the link "`id` blocks `blocked`"; a link that is not there changes nothing. */
	unlink(id: string, blocked: string): Card {
		const { card } = this.locate(id);
		const parsed = parseCardId(blocked);
		const target = parsed ? cardId(parsed.prefix, parsed.number) : blocked;
		if (!card.blocks.includes(target)) return card;
		return this.updateCard(card.id, { blocks: card.blocks.filter((other) => other !== target) });
	}

	/** Appends a progress note to the attempt a chat works on. */
	note(sessionId: string, cwd: string, text: string): { card: Card; attempt: Attempt } {
		const located = this.cardOfSession(sessionId, cwd);
		if (!located) throw new Error("This chat works on no board card.");
		const { projectId, file, card } = located;
		const workspaceId = this.host.sessionScope({ kind: "all" }).locate(cwd)?.workspaceId;
		const index = card.attempts.findLastIndex(
			(attempt) => attempt.sessionId === sessionId || attempt.workspaceId === workspaceId,
		);
		const attempt = card.attempts[index];
		if (!attempt) throw new Error(`${card.id} has no attempt of this chat.`);
		const at = this.now();
		const noted: Attempt = { ...attempt, notes: [...attempt.notes, { text, at }] };
		const next: Card = {
			...card,
			attempts: card.attempts.map((candidate, position) =>
				position === index ? noted : candidate,
			),
			updatedAt: at,
		};
		this.write(projectId, this.replace(file, next), []);
		return { card: next, attempt: noted };
	}

	/** Asks the host's assist model for a card's size; stores it as a suggestion unless a human sized it. */
	private async suggestSize(id: string): Promise<void> {
		let located: Located;
		try {
			located = this.locate(id);
		} catch {
			return;
		}
		if (!wantsSize(located.card)) return;
		let answer: { text: string } | null;
		try {
			answer = await this.host.actions.assist({
				prompt: sizePrompt(located.card),
				maxTokens: SIZE_MAX_TOKENS,
			});
		} catch (error) {
			if (!isDisabledError(error)) this.host.log.warn(`sizing ${id} failed`, error);
			return;
		}
		const size = answer ? parseSize(answer.text) : null;
		if (!size || this.host.signal.aborted) return;
		let latest: Located;
		try {
			latest = this.locate(id);
		} catch {
			return;
		}
		if (!wantsSize(latest.card)) return;
		if (latest.card.size === size && latest.card.sizeSuggested) return;
		this.write(
			latest.projectId,
			this.replace(latest.file, {
				...latest.card,
				size,
				sizeSuggested: true,
				updatedAt: this.now(),
			}),
			[],
		);
	}

	private enqueue(task: () => Promise<void> | void): void {
		this.chain = this.chain
			.then(task)
			.catch((error) => this.host.log.warn("a board rule failed", error));
	}

	/** Resolves once every event, size suggestion, issue fetch, smart review and autopilot pass so far has settled. */
	async idle(): Promise<void> {
		await Promise.all(this.reviewing.values());
		await this.chain;
		await this.sizes.idle();
		await this.issues.idle();
		await this.openspec.idle();
		await this.chain;
		await this.autopilot.idle();
	}

	private applyBound(workspaceId: string, event: BoardEvent): void {
		const bound = this.bound(workspaceId);
		if (!bound) return;
		const file = this.safeCards(bound.projectId);
		const card = file?.cards.find((candidate) => candidate.id === bound.cardId);
		if (!file || !card) return;
		const result = applyEvent(card, event, this.store.settings(bound.projectId).preset, this.now());
		if (!result) return;
		this.write(
			bound.projectId,
			this.replace(file, result.card),
			result.transition ? [result.transition] : [],
		);
	}

	private async settled(workspaceId: string, sessionId: string): Promise<void> {
		if (!this.bound(workspaceId)) return;
		const facts = await this.host.workspaceFacts(workspaceId);
		const chat = facts?.chats.find((candidate) => candidate.sessionId === sessionId);
		const diff = facts?.diff;
		this.applyBound(workspaceId, {
			kind: "settled",
			workspaceId,
			planDone: isPlanDone(chat?.plan),
			diffNonEmpty: !!diff && diff.added + diff.removed > 0,
		});
	}

	/**
	 * Makes a GitHub issue's card's open PR close the issue: reads the PR's description with the user's
	 * `gh` and, when no closing keyword names the issue, appends `Closes #N` — the PR's body only, never
	 * the issue's labels or state. Marked on the attempt once seen, so it runs once per PR.
	 */
	private async linkIssue(workspaceId: string, pr: number): Promise<void> {
		const bound = this.bound(workspaceId);
		if (!bound) return;
		const located = this.cardHolding(bound.projectId, workspaceId);
		const source = located?.card.source;
		if (!located || source?.kind !== "github") return;
		const attempt = located.card.attempts.find(
			(candidate) => candidate.workspaceId === workspaceId,
		);
		if (!attempt || attempt.closesLinked === pr) return;
		const key = `${workspaceId}#${pr}`;
		if ((this.linkRetry.get(key) ?? 0) > this.now()) return;
		const run = (argv: string[]) =>
			this.host.actions.runInWorkspace({ workspaceId, argv, timeoutMs: GH_TIMEOUT_MS });
		const failed = (message: string) => {
			this.linkRetry.set(key, this.now() + LINK_RETRY_MS);
			this.host.log.warn(`linking PR #${pr} to issue #${source.number} failed: ${message}`);
		};
		const viewed = await run(["gh", "pr", "view", String(pr), "--json", "body"]);
		if (!viewed.ok) return failed(runError(viewed, "gh pr view"));
		const body = parsePrBody(viewed.out);
		if (body === null) return failed("gh pr view answered no body");
		if (!closesIssue(body, source.number)) {
			const path = this.store.writeScratch(
				bound.projectId,
				`pr-${pr}-body.md`,
				withCloses(body, source.number),
			);
			try {
				const edited = await run(["gh", "pr", "edit", String(pr), "--body-file", path]);
				if (!edited.ok) return failed(runError(edited, "gh pr edit"));
			} finally {
				this.store.removeScratch(path);
			}
		}
		this.linkRetry.delete(key);
		const latest = this.cardHolding(bound.projectId, workspaceId);
		if (!latest) return;
		this.write(
			bound.projectId,
			this.replace(latest.file, {
				...latest.card,
				attempts: latest.card.attempts.map((candidate) =>
					candidate.workspaceId === workspaceId ? { ...candidate, closesLinked: pr } : candidate,
				),
			}),
			[],
		);
	}

	private changedLive(key: string, signature: string, projectId: string): void {
		if (this.signatures.get(key) === signature) return;
		this.signatures.set(key, signature);
		this.changed(projectId);
	}

	/** The project whose board shows a workspace live: a card's attempt, or an unbound task-spec's card. */
	private shownIn(workspaceId: string): string | undefined {
		return this.bound(workspaceId)?.projectId ?? this.watched.get(workspaceId);
	}

	private changed(projectId: string): void {
		this.host.publish(BOARD_CHANGED, { projectId }, { projectId });
		this.autopilot.schedule();
	}

	/** Subscribes the rules to the host's events; returns the unsubscribe. */
	listen(): () => void {
		const { events } = this.host;
		const actions = throttled((projectId) => this.changed(projectId), this.actionRefreshMs);
		this.autopilot.start();
		const unsubscribes = [
			actions.stop,
			() => this.autopilot.stop(),
			events.subscribe("container.updated", () => this.autopilot.schedule()),
			events.subscribe("container.removed", () => this.autopilot.schedule()),
			events.subscribe("agent.tool", ({ workspaceId }) => {
				const projectId = this.shownIn(workspaceId);
				if (projectId) actions.hit(projectId);
			}),
			events.subscribe("project.opened", ({ projectId }) => this.changed(projectId)),
			events.subscribe("project.closed", ({ projectId }) => this.changed(projectId)),
			events.subscribe("agent.settled", ({ workspaceId, sessionId }) =>
				this.enqueue(() => this.settled(workspaceId, sessionId)),
			),
			events.subscribe("workspace.updated", (workspace) => {
				const projectId = this.shownIn(workspace.id);
				if (!projectId) return;
				this.changedLive(`review:${workspace.id}`, reviewSignature(workspace), projectId);
				if (!this.bound(workspace.id)) return;
				const { review } = workspace;
				if (review?.state === "merged")
					this.enqueue(() =>
						this.applyBound(workspace.id, { kind: "merged", workspaceId: workspace.id }),
					);
				else if (review?.kind === "pull-request" && (review.state ?? "open") === "open")
					this.enqueue(() => this.linkIssue(workspace.id, review.number));
			}),
			events.subscribe("workspace.removed", ({ id }) => {
				this.openspec.forget(id);
				const watched = this.watched.get(id);
				if (watched) {
					this.watched.delete(id);
					this.changed(watched);
				}
				this.enqueue(() => this.applyBound(id, { kind: "removed", workspaceId: id }));
			}),
			events.subscribe("session.state", (record) => {
				const projectId = this.shownIn(record.workspaceId);
				if (projectId)
					this.changedLive(`chat:${record.sessionId}`, chatSignature(record), projectId);
			}),
		];
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	}
}
