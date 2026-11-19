import { userInfo } from "node:os";
import type {
	ChatState,
	ExtensionChatFacts,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionTaskSpec,
	ExtensionWorkspaceFacts,
	GhSetupProblem,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/extension-api/server";
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
import { kickoffText, workflowFor } from "./kickoff";
import {
	type Attempt,
	type BoardSettings,
	type Card,
	type CardOrigin,
	type CardSize,
	type CardSource,
	type CardType,
	type Category,
	type GithubSettings,
	type Placement,
	TEXT_MAX,
	TITLE_MAX,
	type Transition,
	type WipLimits,
	type Workflow,
} from "./model";
import { type ColumnDef, columnFor, columnOfCard, columnsOf, placeInColumn } from "./presets";
import { applyEvent, type BoardEvent, moveByHand } from "./rules";
import {
	parseSize,
	SIZE_DEBOUNCE_MS,
	SIZE_MAX_TOKENS,
	SizeQueue,
	sizePrompt,
	wantsSize,
} from "./sizing";
import { BoardStore, type CardsFile, STORE_VERSION } from "./store";
import {
	DEFERRALS_HEADING,
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

/**
 * A card with its live state, computed per request from host facts and never stored: its attempts'
 * overlays, the cards blocking it and its workspaces' task-specs. A `virtual` card is a source's item the
 * board has not stored (an unbound workspace's task-spec, a GitHub issue nobody started or edited).
 */
export type CardView = Card & {
	live: AttemptLive[];
	blockedBy: string[];
	taskSpecs: TaskSpecRef[];
	virtual?: true;
};

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
}

export interface StartOptions {
	workflow?: Workflow;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	baseRef?: string;
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
}

interface Located {
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
	const chat =
		attempt.sessionId === ""
			? latestChat(facts)
			: facts.chats.find((candidate) => candidate.sessionId === attempt.sessionId);
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

/** One board service per data folder: the store, the rules over host events and the queries' reads. */
export class Board {
	readonly host: ExtensionHostServices;
	readonly store: BoardStore;
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
		this.sizes = new SizeQueue(
			(id) => this.suggestSize(id),
			options.sizeDelayMs ?? SIZE_DEBOUNCE_MS,
			host.signal,
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
			version: STORE_VERSION,
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
	): CardView {
		return {
			...card,
			live: card.attempts.map((attempt) =>
				attemptLive(attempt, facts.get(attempt.workspaceId) ?? null),
			),
			blockedBy: all.filter((other) => other.blocks.includes(card.id)).map((other) => other.id),
			taskSpecs: this.taskSpecsOn(card, specs),
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
		const views = cards.map((card) => this.view(card, facts, cards, specs));
		const rank = Math.max(0, ...cards.map((card) => card.rank)) + 1;
		const fromSpecs = await this.taskSpecCards(project, cards, settings, rank);
		const fromIssues = this.issueCards(project, cards, settings, rank + fromSpecs.length);
		return {
			projectId,
			projectName: project.name,
			prefix: file?.prefix ?? null,
			settings,
			columns: columnsOf(settings.preset),
			cards: [...views, ...fromSpecs, ...fromIssues],
			wip: wipOf(views, settings.wipLimits),
			github: this.githubStatus(projectId, settings.github),
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
		return {
			projectId,
			card: this.view(card, facts, file.cards, specs),
			transitions: this.store.transitions(projectId).filter((entry) => entry.cardId === card.id),
		};
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
		let rank = Math.max(0, ...file.cards.map((other) => other.rank));
		let number = file.nextNumber;
		const cards = drafts.map((draft): Card => {
			const id = cardId(file.prefix, number);
			number += 1;
			rank += 1;
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
				blocks: [],
				specRefs: draft.specRefs ?? [],
				rank,
				category: draft.placement.category,
				column: draft.placement.column,
				ownerHuman: this.owner,
				attempts: draft.attempts ?? [],
				createdBy: actor,
				...(draft.origin ? { origin: draft.origin } : {}),
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
			targets.add(id);
		}
		return [...targets];
	}

	updateCard(id: string, patch: CardPatch, projectId?: string): Card {
		const { projectId: owner, file, card } = this.writable(id, projectId);
		const { size, cancelPending, blocks, ...fields } = patch;
		const next: Card = { ...card, ...fields, updatedAt: this.now() };
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
		const { projectId, file, card } = this.locate(id);
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
		const workflow = options.workflow ?? workflowFor(card);
		this.starting.add(card.id);
		try {
			const created = await this.host.actions.createWorkspace({
				projectId: owner,
				...(options.baseRef ? { baseRef: options.baseRef } : {}),
				kickoff: {
					text: kickoffText(card, workflow),
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
				{ kind: "started", workspaceId: attempt.workspaceId, workflow },
				this.store.settings(owner).preset,
				at,
			);
			const next = result?.card ?? withAttempt;
			this.write(
				owner,
				this.replace(latest.file, next),
				result?.transition ? [result.transition] : [],
			);
			return {
				card: next,
				attempt,
				...(created.kickoffError ? { kickoffError: created.kickoffError } : {}),
			};
		} finally {
			this.starting.delete(card.id);
		}
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

	/** Resolves once every event, size suggestion and issue fetch received so far has settled. */
	async idle(): Promise<void> {
		await this.chain;
		await this.sizes.idle();
		await this.issues.idle();
		await this.chain;
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
	}

	/** Subscribes the rules to the host's events; returns the unsubscribe. */
	listen(): () => void {
		const { events } = this.host;
		const actions = throttled((projectId) => this.changed(projectId), this.actionRefreshMs);
		const unsubscribes = [
			actions.stop,
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
