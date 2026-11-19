import { userInfo } from "node:os";
import type {
	ChatState,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionWorkspaceFacts,
	SessionStateRecord,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/extension-api/server";
import { allocatePrefix, cardId, parseCardId } from "./ids";
import { kickoffText, workflowFor } from "./kickoff";
import type {
	Attempt,
	BoardSettings,
	Card,
	CardOrigin,
	CardSize,
	CardType,
	Category,
	Transition,
	WipLimits,
	Workflow,
} from "./model";
import { type ColumnDef, columnFor, columnOfCard, columnsOf, placeInColumn } from "./presets";
import { applyEvent, type BoardEvent, moveByHand } from "./rules";
import { BoardStore, type CardsFile, STORE_VERSION } from "./store";

export const BOARD_CHANGED = "board.changed";

export interface AttemptLive {
	workspaceId: string;
	sessionId: string;
	/** The workspace is still open. */
	open: boolean;
	chat: { state: ChatState; unread: boolean; title: string } | null;
	plan: { open: number; total: number } | null;
	diff: { added: number; removed: number } | null;
	pr: ExtensionWorkspaceFacts["review"];
}

/** A card with its live state, computed per request from host facts and never stored. */
export type CardView = Card & { live: AttemptLive[]; blockedBy: string[] };

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
}

export interface InboxItem {
	projectId: string;
	projectName: string;
	reason: "needs_you" | "failed";
	card: CardView;
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

export function attemptLive(attempt: Attempt, facts: ExtensionWorkspaceFacts | null): AttemptLive {
	const base = { workspaceId: attempt.workspaceId, sessionId: attempt.sessionId };
	if (!facts || attempt.removedAt !== undefined)
		return { ...base, open: false, chat: null, plan: null, diff: null, pr: null };
	const chat = facts.chats.find((candidate) => candidate.sessionId === attempt.sessionId);
	return {
		...base,
		open: true,
		chat: chat ? { state: chat.state, unread: chat.unread, title: chat.title } : null,
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

/** One board service per data folder: the store, the rules over host events and the queries' reads. */
export class Board {
	readonly host: ExtensionHostServices;
	readonly store: BoardStore;
	private readonly now: () => number;
	private readonly owner: string;
	private index: Map<string, { projectId: string; cardId: string }> | null = null;
	private chain: Promise<void> = Promise.resolve();
	private readonly starting = new Set<string>();
	private readonly signatures = new Map<string, string>();

	constructor(host: ExtensionHostServices, options: { now?: () => number; owner?: string } = {}) {
		this.host = host;
		this.now = options.now ?? Date.now;
		this.owner = options.owner ?? localUser();
		this.store = new BoardStore(host.dataDir, host.log, this.now);
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
		this.host.publish(BOARD_CHANGED, { projectId }, { projectId });
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

	private async facts(
		cards: readonly Card[],
	): Promise<Map<string, ExtensionWorkspaceFacts | null>> {
		const ids = new Set(
			cards.flatMap((card) =>
				card.attempts
					.filter((attempt) => attempt.removedAt === undefined)
					.map((attempt) => attempt.workspaceId),
			),
		);
		return new Map(
			await Promise.all(
				[...ids].map(
					async (id) => [id, await this.host.workspaceFacts(id).catch(() => null)] as const,
				),
			),
		);
	}

	private view(
		card: Card,
		facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
		all: readonly Card[],
	): CardView {
		return {
			...card,
			live: card.attempts.map((attempt) =>
				attemptLive(attempt, facts.get(attempt.workspaceId) ?? null),
			),
			blockedBy: all.filter((other) => other.blocks.includes(card.id)).map((other) => other.id),
		};
	}

	async get(projectId: string): Promise<BoardView> {
		const project = this.project(projectId);
		const file = this.store.cards(projectId);
		const settings = this.store.settings(projectId);
		const cards = [...(file?.cards ?? [])].sort(byRank);
		const facts = await this.facts(cards);
		const views = cards.map((card) => this.view(card, facts, cards));
		return {
			projectId,
			projectName: project.name,
			prefix: file?.prefix ?? null,
			settings,
			columns: columnsOf(settings.preset),
			cards: views,
			wip: wipOf(views, settings.wipLimits),
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

	async card(
		id: string,
	): Promise<{ projectId: string; card: CardView; transitions: Transition[] }> {
		const { projectId, file, card } = this.locate(id);
		const facts = await this.facts([card]);
		return {
			projectId,
			card: this.view(card, facts, file.cards),
			transitions: this.store.transitions(projectId).filter((entry) => entry.cardId === card.id),
		};
	}

	createCard(projectId: string, input: CardInput, createdBy: "human" | "agent"): Card {
		const project = this.project(projectId);
		const file = this.fileFor(project);
		const { preset } = this.store.settings(projectId);
		const placement =
			createdBy === "agent"
				? { category: "triage" as const, column: columnFor(preset, "triage") }
				: input.column !== undefined
					? placeInColumn(preset, { category: "backlog" }, input.column)
					: { category: "backlog" as const, column: columnFor(preset, "backlog") };
		if (!placement) throw new Error(`The board has no column ${input.column}.`);
		const at = this.now();
		const id = cardId(file.prefix, file.nextNumber);
		const card: Card = {
			id,
			source: { kind: "native", ref: id },
			title: input.title,
			description: input.description ?? "",
			acceptance: input.acceptance ?? [],
			type: input.type ?? "feature",
			...(input.size
				? { size: input.size, ...(createdBy === "agent" ? { sizeSuggested: true } : {}) }
				: {}),
			labels: input.labels ?? [],
			blocks: [],
			specRefs: input.specRefs ?? [],
			rank: Math.max(0, ...file.cards.map((other) => other.rank)) + 1,
			category: placement.category,
			column: placement.column,
			ownerHuman: this.owner,
			attempts: [],
			createdBy,
			...(createdBy === "agent" && input.origin ? { origin: input.origin } : {}),
			createdAt: at,
			updatedAt: at,
		};
		this.write(
			project.id,
			{ ...file, nextNumber: file.nextNumber + 1, cards: [...file.cards, card] },
			[
				{
					cardId: id,
					from: null,
					to: placement,
					at,
					actor: createdBy,
					reason: createdBy === "agent" ? "created by an agent into Triage" : "created",
				},
			],
		);
		return card;
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

	updateCard(id: string, patch: CardPatch): Card {
		const { projectId, file, card } = this.locate(id);
		const { size, cancelPending, blocks, ...fields } = patch;
		const next: Card = { ...card, ...fields, updatedAt: this.now() };
		if (size !== undefined) {
			delete next.size;
			delete next.sizeSuggested;
			if (size !== null) next.size = size;
		}
		if (blocks !== undefined) next.blocks = this.blockTargets(file, card, blocks);
		if (cancelPending === false) delete next.cancelPending;
		this.write(projectId, this.replace(file, next), []);
		return next;
	}

	moveCard(id: string, column: string, rank?: number): Card {
		const { projectId, file, card } = this.locate(id);
		const result = moveByHand(
			card,
			column,
			this.store.settings(projectId).preset,
			this.now(),
			rank,
		);
		if (!result) throw new Error(`The board has no column ${column}.`);
		this.write(
			projectId,
			this.replace(file, result.card),
			result.transition ? [result.transition] : [],
		);
		return result.card;
	}

	deleteCard(id: string): { deleted: string } {
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
	): Promise<{ card: Card; attempt: Attempt; kickoffError?: string }> {
		const { projectId, card } = this.locate(id);
		if (card.category === "triage")
			throw new Error(`Accept ${card.id} from Triage before starting it.`);
		if (this.starting.has(card.id)) throw new Error(`${card.id} is already starting.`);
		const workflow = options.workflow ?? workflowFor(card);
		this.starting.add(card.id);
		try {
			const created = await this.host.actions.createWorkspace({
				projectId,
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
				this.store.settings(projectId).preset,
				at,
			);
			const next = result?.card ?? withAttempt;
			this.write(
				projectId,
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
		} else this.host.publish(BOARD_CHANGED, { projectId }, { projectId });
		return next;
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

	private enqueue(task: () => Promise<void> | void): void {
		this.chain = this.chain
			.then(task)
			.catch((error) => this.host.log.warn("a board rule failed", error));
	}

	/** Resolves once every event received so far has been applied. */
	idle(): Promise<void> {
		return this.chain;
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

	private changedLive(key: string, signature: string, projectId: string): void {
		if (this.signatures.get(key) === signature) return;
		this.signatures.set(key, signature);
		this.host.publish(BOARD_CHANGED, { projectId }, { projectId });
	}

	/** Subscribes the rules to the host's events; returns the unsubscribe. */
	listen(): () => void {
		const { events } = this.host;
		const unsubscribes = [
			events.subscribe("agent.settled", ({ workspaceId, sessionId }) =>
				this.enqueue(() => this.settled(workspaceId, sessionId)),
			),
			events.subscribe("workspace.updated", (workspace) => {
				const bound = this.bound(workspace.id);
				if (!bound) return;
				this.changedLive(`review:${workspace.id}`, reviewSignature(workspace), bound.projectId);
				if (workspace.review?.state === "merged")
					this.enqueue(() =>
						this.applyBound(workspace.id, { kind: "merged", workspaceId: workspace.id }),
					);
			}),
			events.subscribe("workspace.removed", ({ id }) =>
				this.enqueue(() => this.applyBound(id, { kind: "removed", workspaceId: id })),
			),
			events.subscribe("session.state", (record) => {
				const bound = this.bound(record.workspaceId);
				if (bound)
					this.changedLive(`chat:${record.sessionId}`, chatSignature(record), bound.projectId);
			}),
		];
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	}
}
