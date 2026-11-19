import type {
	ExtensionHostProject,
	ExtensionWorkspaceFacts,
} from "@thinkrail/extension-api/server";
import { type Activity, initiativeActivity } from "./activity";
import type { Located } from "./board";
import { DAY_MS, dayOf, dayOfIso, isoOfDay, today } from "./days";
import { type Forecast, forecast } from "./forecast";
import { type HealthView, suggestHealth } from "./health";
import { cardId as formatCardId, parseCardId } from "./ids";
import { type Insights, insights } from "./insights";
import type { KickoffContext } from "./kickoff";
import {
	type Card,
	type CardRef,
	type CardSize,
	type Category,
	estimateOf,
	type Health,
	type Horizon,
	type Initiative,
	type InitiativeUpdate,
	latestAttempt,
	type Milestone,
	pointsOf,
	type RoadmapProject,
	type Transition,
} from "./model";
import {
	type AgentState,
	agentStateOf,
	blockedCards,
	initiativeCards,
	type Rollup,
	type RollupCard,
	rollup,
	subtree,
	timeSpent,
} from "./rollups";
import {
	criticalWithin,
	dependentsOf,
	isPinnable,
	type Schedule,
	type ScheduleCard,
	schedule,
} from "./schedule";
import type { BoardStore, CardsFile, InitiativesFile, ProjectsFile } from "./store";
import { attemptChat } from "./taskSpecs";
import { completions, cycleTimes, starts, type Throughput, throughput } from "./throughput";

/** What the roadmap needs of its board: the store, the open projects, card lookup and live facts. */
export interface RoadmapHost {
	store: BoardStore;
	now(): number;
	/** The open repository project; throws for any other. */
	project(projectId: string): ExtensionHostProject;
	/** A stored card on any board; throws for an unknown one. */
	locate(cardId: string): Located;
	/** Writes a board's cards without publishing. */
	saveCards(projectId: string, file: CardsFile): void;
	changed(projectId: string): void;
	facts(cards: readonly Card[]): Promise<Map<string, ExtensionWorkspaceFacts | null>>;
}

export interface InitiativeInput {
	title: string;
	outcome?: string;
	criteria?: string[];
	horizon?: Horizon;
	parentId?: string;
	target?: string;
	appetiteDays?: number;
	specRefs?: string[];
}

export interface InitiativePatch {
	title?: string;
	outcome?: string;
	criteria?: string[];
	horizon?: Horizon;
	/** `null` makes it top-level. */
	parentId?: string | null;
	target?: string | null;
	appetiteDays?: number | null;
	specRefs?: string[];
	/** `override: null` drops the human's override, `note: null` the note. */
	health?: { override?: Health | null; note?: string | null };
	/** `false` accepts an agent's proposal. */
	proposed?: false;
}

export interface MilestoneInput {
	title: string;
	target?: string;
}

export interface MilestonePatch {
	title?: string;
	target?: string | null;
}

export interface ProjectInput {
	title: string;
	initiativeId?: string;
	milestones?: MilestoneInput[];
}

export interface ProjectPatch {
	title?: string;
	initiativeId?: string | null;
	proposed?: false;
}

/** An initiative in the tree: depth-first, each after its parent. */
export type InitiativeNode = Initiative & {
	depth: number;
	childIds: string[];
	/** This board's cards it holds, its projects' and nested initiatives' included. */
	memberCardIds: string[];
	/** Other boards' cards it holds, nested initiatives' included. */
	memberExternalCards: CardRef[];
};

/** Another board's card an initiative includes; `missing` once it is gone. */
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

export interface RoadmapView {
	projectId: string;
	projectName: string;
	initiatives: InitiativeNode[];
	projects: RoadmapProject[];
	externalCards: ExternalCard[];
	rollups: {
		initiatives: Record<string, Rollup>;
		projects: Record<string, Rollup>;
		milestones: Record<string, Rollup>;
	};
	health: Record<string, HealthView>;
	forecast: Record<string, Forecast>;
	/** The board's step graph; days are days since 1970-01-01 UTC. */
	schedule: Schedule;
	/** Each initiative's own critical path: the critical nodes among its cards and milestones. */
	critical: Record<string, string[]>;
	throughput: Throughput;
	/** Completed cards' cycle times, in ms. */
	cycleTimes: Record<string, number>;
	insufficientData: { throughput: boolean; initiatives: string[] };
}

interface Agent {
	state: AgentState;
	since: number;
}

/** A board read once for the derivations. */
interface BoardData {
	cards: Card[];
	transitions: Transition[];
	projects: RoadmapProject[];
}

const HORIZON_ORDER: Record<Horizon, number> = { now: 0, next: 1, later: 2 };
const byRank = (a: { rank: number; createdAt: number }, b: { rank: number; createdAt: number }) =>
	a.rank - b.rank || a.createdAt - b.createdAt;

function canonicalCardId(id: string): string {
	const parsed = parseCardId(id);
	return parsed ? formatCardId(parsed.prefix, parsed.number) : id;
}

/** The card's latest attempt's agent: working, waiting for the human (since its chat's update) or failed. */
function agentOf(
	card: Card,
	facts: ReadonlyMap<string, ExtensionWorkspaceFacts | null>,
): Agent | null {
	const attempt = latestAttempt(card);
	if (!attempt || attempt.removedAt !== undefined) return null;
	const chat = attemptChat(attempt, facts.get(attempt.workspaceId) ?? null);
	const state = agentStateOf(chat?.state);
	return chat && state ? { state, since: chat.updatedAt } : null;
}

/** The schedule's view of a board's cards and milestones, from the cards and their transitions. */
function scheduleOf(data: BoardData, now: number): Schedule {
	const started = starts(data.transitions);
	const done = completions(data.transitions);
	const projects = new Map(data.projects.map((project) => [project.id, project]));
	const cards = data.cards.map((card): ScheduleCard => {
		const project = card.roadmapProjectId ? projects.get(card.roadmapProjectId) : undefined;
		const span = started.get(card.id);
		const lastStart = span?.last ?? latestAttempt(card)?.startedAt;
		const completedAt =
			done.get(card.id) ?? (card.category === "completed" ? card.updatedAt : undefined);
		return {
			id: card.id,
			category: card.category,
			blocks: card.blocks,
			estimateDays: estimateOf(card),
			...(card.pinnedStart ? { pinnedStart: dayOfIso(card.pinnedStart) } : {}),
			...(lastStart !== undefined ? { startedAt: dayOf(lastStart) } : {}),
			...(span ? { firstStartedAt: dayOf(span.first) } : {}),
			...(completedAt !== undefined ? { completedAt: dayOf(completedAt) } : {}),
			...(project ? { lane: project.id } : {}),
			...(project?.milestones.some((milestone) => milestone.id === card.milestoneId)
				? { milestoneId: card.milestoneId }
				: {}),
		};
	});
	const milestones = data.projects.flatMap((project) =>
		project.milestones.map((milestone) => ({
			id: milestone.id,
			lane: project.id,
			...(milestone.target ? { target: dayOfIso(milestone.target) } : {}),
		})),
	);
	return schedule({ cards, milestones, today: today(now) });
}

/** Initiatives depth-first: roots (and orphans) by horizon then rank, children by rank. */
function tree(initiatives: readonly Initiative[]): InitiativeNode[] {
	const ids = new Set(initiatives.map((initiative) => initiative.id));
	const children = new Map<string, Initiative[]>();
	const roots: Initiative[] = [];
	for (const initiative of initiatives) {
		if (initiative.parentId && ids.has(initiative.parentId))
			children.set(initiative.parentId, [...(children.get(initiative.parentId) ?? []), initiative]);
		else roots.push(initiative);
	}
	roots.sort((a, b) => HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon] || byRank(a, b));
	const out: InitiativeNode[] = [];
	const seen = new Set<string>();
	const walk = (initiative: Initiative, depth: number) => {
		if (seen.has(initiative.id)) return;
		seen.add(initiative.id);
		const kids = [...(children.get(initiative.id) ?? [])].sort(byRank);
		out.push({
			...initiative,
			depth,
			childIds: kids.map((kid) => kid.id),
			memberCardIds: [],
			memberExternalCards: [],
		});
		for (const kid of kids) walk(kid, depth + 1);
	};
	for (const root of roots) walk(root, 0);
	return out;
}

/** The roadmap of each board: initiatives, roadmap projects and milestones, and their derivations. */
export class Roadmap {
	private readonly host: RoadmapHost;

	constructor(host: RoadmapHost) {
		this.host = host;
	}

	private get store(): BoardStore {
		return this.host.store;
	}

	private projectName(projectId: string): string | null {
		try {
			return this.host.project(projectId).name;
		} catch {
			return null;
		}
	}

	private data(projectId: string): BoardData {
		return {
			cards: this.store.cards(projectId)?.cards ?? [],
			transitions: this.store.transitions(projectId),
			projects: this.store.roadmapProjects(projectId).projects,
		};
	}

	private commit(
		projectId: string,
		files: { initiatives?: InitiativesFile; projects?: ProjectsFile; cards?: CardsFile },
	): void {
		if (files.initiatives) this.store.saveInitiatives(projectId, files.initiatives);
		if (files.projects) this.store.saveRoadmapProjects(projectId, files.projects);
		if (files.cards) this.host.saveCards(projectId, files.cards);
		this.host.changed(projectId);
	}

	private initiative(
		projectId: string,
		id: string,
	): { file: InitiativesFile; initiative: Initiative } {
		const file = this.store.initiatives(projectId);
		const initiative = file.initiatives.find((candidate) => candidate.id === id);
		if (!initiative) throw new Error(`No initiative ${id} on this board.`);
		return { file, initiative };
	}

	private roadmapProject(
		projectId: string,
		id: string,
	): { file: ProjectsFile; project: RoadmapProject } {
		const file = this.store.roadmapProjects(projectId);
		const project = file.projects.find((candidate) => candidate.id === id);
		if (!project) throw new Error(`No project ${id} on this board.`);
		return { file, project };
	}

	/** Throws unless the board has the roadmap project. */
	requireProject(projectId: string, id: string): void {
		this.roadmapProject(projectId, id);
	}

	private replaceInitiative(file: InitiativesFile, next: Initiative): InitiativesFile {
		return {
			...file,
			initiatives: file.initiatives.map((candidate) =>
				candidate.id === next.id ? next : candidate,
			),
		};
	}

	private replaceProject(file: ProjectsFile, next: RoadmapProject): ProjectsFile {
		return {
			...file,
			projects: file.projects.map((candidate) => (candidate.id === next.id ? next : candidate)),
		};
	}

	private replaceCards(file: CardsFile, changed: readonly Card[]): CardsFile {
		const byId = new Map(changed.map((card) => [card.id, card]));
		return { ...file, cards: file.cards.map((card) => byId.get(card.id) ?? card) };
	}

	async get(projectId: string): Promise<RoadmapView> {
		const project = this.host.project(projectId);
		const now = this.host.now();
		const data = this.data(projectId);
		const { initiatives } = this.store.initiatives(projectId);
		const settings = this.store.settings(projectId);
		const nodes = tree(initiatives);

		const externalRefs = new Map<string, CardRef>();
		for (const initiative of initiatives)
			for (const ref of initiative.externalCards) externalRefs.set(ref.cardId, ref);
		const externals = new Map<string, Located>();
		for (const ref of externalRefs.values()) {
			try {
				const located = this.host.locate(ref.cardId);
				if (located.projectId !== projectId) externals.set(ref.cardId, located);
			} catch {}
		}
		const facts = await this.host.facts([
			...data.cards,
			...[...externals.values()].map((located) => located.card),
		]);

		const rollupCards = new Map<string, RollupCard>();
		const agents = new Map<string, Agent>();
		const addBoard = (
			cards: readonly Card[],
			transitions: readonly Transition[],
			only?: Set<string>,
		) => {
			const blocked = blockedCards(cards);
			const spent = timeSpent(transitions, now);
			for (const card of cards) {
				if (only && !only.has(card.id)) continue;
				const agent = agentOf(card, facts);
				if (agent) agents.set(card.id, agent);
				rollupCards.set(card.id, {
					id: card.id,
					category: card.category,
					...(card.size ? { size: card.size } : {}),
					...(agent ? { agent: agent.state } : {}),
					blocked: blocked.has(card.id),
					timeSpentMs: spent.get(card.id) ?? 0,
				});
			}
		};
		addBoard(data.cards, data.transitions);
		const externalBoards = new Map<string, Located[]>();
		for (const located of externals.values())
			externalBoards.set(located.projectId, [
				...(externalBoards.get(located.projectId) ?? []),
				located,
			]);
		for (const [boardId, located] of externalBoards) {
			const [first] = located;
			if (first)
				addBoard(
					first.file.cards,
					this.store.transitions(boardId),
					new Set(located.map((entry) => entry.card.id)),
				);
		}
		const rollupOf = (ids: Iterable<string>) =>
			rollup([...ids].flatMap((id) => rollupCards.get(id) ?? []));

		const flow = throughput(
			data.transitions,
			(id) => {
				const card = data.cards.find((candidate) => candidate.id === id);
				return card ? pointsOf(card) : pointsOf({});
			},
			now,
		);
		const plan = scheduleOf(data, now);
		const reviewWip = {
			count: data.cards.filter((card) => card.category === "review").length,
			limit: settings.wipLimits.review,
		};

		const rollups: RoadmapView["rollups"] = { initiatives: {}, projects: {}, milestones: {} };
		const health: Record<string, HealthView> = {};
		const forecasts: Record<string, Forecast> = {};
		const critical: Record<string, string[]> = {};
		const insufficient: string[] = [];
		for (const node of nodes) {
			const members = initiativeCards(node.id, initiatives, data.projects, data.cards);
			node.memberCardIds = members.local;
			node.memberExternalCards = members.external;
			const ids = [
				...members.local,
				...members.external.map((ref) => ref.cardId).filter((id) => externals.has(id)),
			];
			const counted = rollupOf(ids);
			rollups.initiatives[node.id] = counted;
			const scope = subtree(initiatives, node.id);
			const milestones = data.projects
				.filter((candidate) => candidate.initiativeId && scope.has(candidate.initiativeId))
				.flatMap((candidate) => candidate.milestones.map((milestone) => milestone.id));
			const onPath = criticalWithin(plan, new Set([...members.local, ...milestones]));
			critical[node.id] = plan.nodes
				.filter((entry) => onPath.has(entry.id))
				.map((entry) => entry.id);
			const predicted = forecast({
				key: `${projectId}:${node.id}`,
				weeklyPoints: flow.weeks.map((week) => week.points),
				remainingPoints: counted.points.total - counted.points.completed,
				totalPoints: counted.points.total,
				now,
			});
			forecasts[node.id] = predicted;
			if (predicted.status === "insufficient") insufficient.push(node.id);
			health[node.id] = suggestHealth({
				...(node.target ? { target: node.target } : {}),
				start: node.createdAt,
				forecast: predicted,
				cards: ids.flatMap((id) => {
					const card = rollupCards.get(id);
					if (!card) return [];
					const agent = agents.get(id);
					return [
						{
							id,
							category: card.category,
							critical: onPath.has(id),
							blocked: card.blocked,
							...(agent ? { agent: agent.state, waitingSince: agent.since } : {}),
						},
					];
				}),
				reviewWip,
				...(node.appetiteDays !== undefined ? { appetiteDays: node.appetiteDays } : {}),
				timeSpentMs: counted.timeSpentMs,
				...(node.health?.override ? { override: node.health.override } : {}),
				...(node.health?.note ? { note: node.health.note } : {}),
				now,
			});
		}
		for (const roadmapProject of data.projects) {
			const cards = data.cards.filter((card) => card.roadmapProjectId === roadmapProject.id);
			rollups.projects[roadmapProject.id] = rollupOf(cards.map((card) => card.id));
			for (const milestone of roadmapProject.milestones)
				rollups.milestones[milestone.id] = rollupOf(
					cards.filter((card) => card.milestoneId === milestone.id).map((card) => card.id),
				);
		}

		return {
			projectId,
			projectName: project.name,
			initiatives: nodes,
			projects: data.projects,
			externalCards: [...externalRefs.values()].map((ref): ExternalCard => {
				const located = externals.get(ref.cardId);
				const projectName = this.projectName(located?.projectId ?? ref.projectId);
				if (!located)
					return { projectId: ref.projectId, projectName, cardId: ref.cardId, missing: true };
				return {
					projectId: located.projectId,
					projectName,
					cardId: located.card.id,
					title: located.card.title,
					category: located.card.category,
					...(located.card.size ? { size: located.card.size } : {}),
				};
			}),
			rollups,
			health,
			forecast: forecasts,
			schedule: plan,
			critical,
			throughput: flow,
			cycleTimes: Object.fromEntries(cycleTimes(data.transitions)),
			insufficientData: { throughput: flow.insufficientData, initiatives: insufficient },
		};
	}

	/** The board's flow over the last `weeks` weeks (`insights.ts`), its cards' current waits included. */
	async insights(projectId: string, weeks: number): Promise<Insights> {
		this.host.project(projectId);
		const { cards, transitions } = this.data(projectId);
		const waiting = cards.filter((card) => card.category === "started");
		const facts = await this.host.facts(waiting);
		const since = new Map<string, number>();
		for (const card of waiting) {
			const agent = agentOf(card, facts);
			if (agent?.state === "waiting") since.set(card.id, agent.since);
		}
		return insights({
			transitions,
			cards: cards.map((card) => {
				const waitingSince = since.get(card.id);
				return {
					id: card.id,
					category: card.category,
					...(waitingSince !== undefined ? { waitingSince } : {}),
				};
			}),
			now: this.host.now(),
			weeks,
		});
	}

	createInitiative(projectId: string, input: InitiativeInput, by: "human" | "agent"): Initiative {
		this.host.project(projectId);
		const file = this.store.initiatives(projectId);
		if (input.parentId) this.initiative(projectId, input.parentId);
		const at = this.host.now();
		const initiative: Initiative = {
			id: `I-${file.nextNumber}`,
			...(input.parentId ? { parentId: input.parentId } : {}),
			title: input.title,
			outcome: input.outcome ?? "",
			criteria: input.criteria ?? [],
			horizon: input.horizon ?? "later",
			rank: Math.max(0, ...file.initiatives.map((other) => other.rank)) + 1,
			...(input.target ? { target: input.target } : {}),
			...(input.appetiteDays !== undefined ? { appetiteDays: input.appetiteDays } : {}),
			specRefs: input.specRefs ?? [],
			updates: [],
			cardIds: [],
			externalCards: [],
			...(by === "agent" ? { proposed: true as const, proposedBy: "agent" as const } : {}),
			createdAt: at,
			updatedAt: at,
		};
		this.commit(projectId, {
			initiatives: {
				...file,
				nextNumber: file.nextNumber + 1,
				initiatives: [...file.initiatives, initiative],
			},
		});
		return initiative;
	}

	updateInitiative(projectId: string, id: string, patch: InitiativePatch): Initiative {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		const { parentId, target, appetiteDays, health, proposed, ...fields } = patch;
		const next: Initiative = { ...initiative, ...fields, updatedAt: this.host.now() };
		if (parentId === null) delete next.parentId;
		else if (parentId !== undefined) {
			this.initiative(projectId, parentId);
			if (subtree(file.initiatives, id).has(parentId))
				throw new Error(`${id} cannot nest under itself or an initiative nested in it.`);
			next.parentId = parentId;
		}
		if (target === null) delete next.target;
		else if (target !== undefined) next.target = target;
		if (appetiteDays === null) delete next.appetiteDays;
		else if (appetiteDays !== undefined) next.appetiteDays = appetiteDays;
		if (health) {
			const override =
				health.override === undefined ? initiative.health?.override : health.override;
			const note = health.note === undefined ? initiative.health?.note : health.note;
			delete next.health;
			if (override || note)
				next.health = { ...(override ? { override } : {}), ...(note ? { note } : {}) };
		}
		if (proposed === false) delete next.proposed;
		this.commit(projectId, { initiatives: this.replaceInitiative(file, next) });
		return next;
	}

	/** Deletes an initiative: its nested ones move up to its parent, its projects keep no initiative. */
	deleteInitiative(projectId: string, id: string): { deleted: string } {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		const initiatives = file.initiatives
			.filter((candidate) => candidate.id !== id)
			.map((candidate): Initiative => {
				if (candidate.parentId !== id) return candidate;
				const { parentId: _parent, ...rest } = candidate;
				return initiative.parentId ? { ...rest, parentId: initiative.parentId } : rest;
			});
		const projects = this.store.roadmapProjects(projectId);
		const held = projects.projects.some((project) => project.initiativeId === id);
		this.commit(projectId, {
			initiatives: { ...file, initiatives },
			...(held
				? {
						projects: {
							...projects,
							projects: projects.projects.map((project) => {
								if (project.initiativeId !== id) return project;
								const { initiativeId: _initiative, ...rest } = project;
								return rest;
							}),
						},
					}
				: {}),
		});
		return { deleted: id };
	}

	/** Moves an initiative to a horizon, at `rank` or after the horizon's last. */
	moveInitiative(projectId: string, id: string, horizon: Horizon, rank?: number): Initiative {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		const last = Math.max(
			0,
			...file.initiatives
				.filter((other) => other.horizon === horizon && other.id !== id)
				.map((other) => other.rank),
		);
		const next: Initiative = {
			...initiative,
			horizon,
			rank: rank ?? last + 1,
			updatedAt: this.host.now(),
		};
		this.commit(projectId, { initiatives: this.replaceInitiative(file, next) });
		return next;
	}

	/** Marks an initiative closed, once the human confirmed it done; a closed one stays closed. */
	closeInitiative(projectId: string, id: string): Initiative {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		if (initiative.closedAt !== undefined) throw new Error(`${id} is already closed.`);
		if (initiative.proposed) throw new Error(`${id} is a proposal; accept it before closing it.`);
		const at = this.host.now();
		const next: Initiative = { ...initiative, closedAt: at, updatedAt: at };
		this.commit(projectId, { initiatives: this.replaceInitiative(file, next) });
		return next;
	}

	/**
	 * What moved in an initiative over the last `sinceDays` days: its cards' (nested initiatives' and other
	 * boards' included) category changes and notes, from each board's transition log.
	 */
	activity(
		projectId: string,
		id: string,
		sinceDays: number,
	): { initiative: Initiative; activity: Activity; titles: Record<string, string> } {
		this.host.project(projectId);
		const { initiative } = this.initiative(projectId, id);
		const data = this.data(projectId);
		const members = initiativeCards(
			id,
			this.store.initiatives(projectId).initiatives,
			data.projects,
			data.cards,
		);
		const local = new Set(members.local);
		const cards = data.cards.filter((card) => local.has(card.id));
		const transitions = data.transitions.filter((transition) => local.has(transition.cardId));
		for (const ref of members.external) {
			try {
				const located = this.host.locate(ref.cardId);
				cards.push(located.card);
				transitions.push(
					...this.store
						.transitions(located.projectId)
						.filter((transition) => transition.cardId === located.card.id),
				);
			} catch {}
		}
		const now = this.host.now();
		return {
			initiative,
			activity: initiativeActivity(cards, transitions, now - sinceDays * DAY_MS, now),
			titles: Object.fromEntries(cards.map((card) => [card.id, card.title])),
		};
	}

	/** Adds cards by id: this board's into the initiative's cards, another board's as external cards. */
	addCards(projectId: string, id: string, cardIds: readonly string[]): Initiative {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		const local = new Set(initiative.cardIds);
		const external = new Map(initiative.externalCards.map((ref) => [ref.cardId, ref]));
		for (const raw of cardIds) {
			const located = this.host.locate(raw);
			if (located.projectId === projectId) local.add(located.card.id);
			else external.set(located.card.id, { projectId: located.projectId, cardId: located.card.id });
		}
		const next: Initiative = {
			...initiative,
			cardIds: [...local],
			externalCards: [...external.values()],
			updatedAt: this.host.now(),
		};
		this.commit(projectId, { initiatives: this.replaceInitiative(file, next) });
		return next;
	}

	removeCards(projectId: string, id: string, cardIds: readonly string[]): Initiative {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, id);
		const removed = new Set(cardIds.map(canonicalCardId));
		const next: Initiative = {
			...initiative,
			cardIds: initiative.cardIds.filter((card) => !removed.has(card)),
			externalCards: initiative.externalCards.filter((ref) => !removed.has(ref.cardId)),
			updatedAt: this.host.now(),
		};
		this.commit(projectId, { initiatives: this.replaceInitiative(file, next) });
		return next;
	}

	private milestones(
		file: ProjectsFile,
		inputs: readonly MilestoneInput[],
	): { milestones: Milestone[]; next: number } {
		let next = file.nextMilestoneNumber;
		const milestones = inputs.map((input): Milestone => {
			const milestone = {
				id: `M-${next}`,
				title: input.title,
				...(input.target ? { target: input.target } : {}),
			};
			next += 1;
			return milestone;
		});
		return { milestones, next };
	}

	createProject(projectId: string, input: ProjectInput, by: "human" | "agent"): RoadmapProject {
		this.host.project(projectId);
		if (input.initiativeId) this.initiative(projectId, input.initiativeId);
		const file = this.store.roadmapProjects(projectId);
		const { milestones, next } = this.milestones(file, input.milestones ?? []);
		const at = this.host.now();
		const project: RoadmapProject = {
			id: `P-${file.nextNumber}`,
			...(input.initiativeId ? { initiativeId: input.initiativeId } : {}),
			title: input.title,
			milestones,
			...(by === "agent" ? { proposed: true as const, proposedBy: "agent" as const } : {}),
			createdAt: at,
			updatedAt: at,
		};
		this.commit(projectId, {
			projects: {
				...file,
				nextNumber: file.nextNumber + 1,
				nextMilestoneNumber: next,
				projects: [...file.projects, project],
			},
		});
		return project;
	}

	updateProject(projectId: string, id: string, patch: ProjectPatch): RoadmapProject {
		this.host.project(projectId);
		const { file, project } = this.roadmapProject(projectId, id);
		const { initiativeId, proposed, ...fields } = patch;
		const next: RoadmapProject = { ...project, ...fields, updatedAt: this.host.now() };
		if (initiativeId === null) delete next.initiativeId;
		else if (initiativeId !== undefined) {
			this.initiative(projectId, initiativeId);
			next.initiativeId = initiativeId;
		}
		if (proposed === false) delete next.proposed;
		this.commit(projectId, { projects: this.replaceProject(file, next) });
		return next;
	}

	/** Deletes a roadmap project: its cards keep no project or milestone. */
	deleteProject(projectId: string, id: string): { deleted: string } {
		this.host.project(projectId);
		const { file } = this.roadmapProject(projectId, id);
		const cards = this.store.cards(projectId);
		const held = cards?.cards.filter((card) => card.roadmapProjectId === id) ?? [];
		const at = this.host.now();
		this.commit(projectId, {
			projects: { ...file, projects: file.projects.filter((project) => project.id !== id) },
			...(cards && held.length > 0
				? {
						cards: this.replaceCards(
							cards,
							held.map((card) => {
								const { roadmapProjectId: _project, milestoneId: _milestone, ...rest } = card;
								return { ...rest, updatedAt: at };
							}),
						),
					}
				: {}),
		});
		return { deleted: id };
	}

	private milestoneHolder(
		projectId: string,
		milestoneId: string,
	): { file: ProjectsFile; project: RoadmapProject; milestone: Milestone } {
		const file = this.store.roadmapProjects(projectId);
		for (const project of file.projects) {
			const milestone = project.milestones.find((candidate) => candidate.id === milestoneId);
			if (milestone) return { file, project, milestone };
		}
		throw new Error(`No milestone ${milestoneId} on this board.`);
	}

	createMilestone(projectId: string, roadmapProjectId: string, input: MilestoneInput): Milestone {
		this.host.project(projectId);
		const { file, project } = this.roadmapProject(projectId, roadmapProjectId);
		const { milestones, next } = this.milestones(file, [input]);
		const [milestone] = milestones;
		if (!milestone) throw new Error("The milestone was not created.");
		this.commit(projectId, {
			projects: {
				...this.replaceProject(file, {
					...project,
					milestones: [...project.milestones, milestone],
					updatedAt: this.host.now(),
				}),
				nextMilestoneNumber: next,
			},
		});
		return milestone;
	}

	updateMilestone(projectId: string, milestoneId: string, patch: MilestonePatch): Milestone {
		this.host.project(projectId);
		const { file, project, milestone } = this.milestoneHolder(projectId, milestoneId);
		const next: Milestone = {
			...milestone,
			...(patch.title !== undefined ? { title: patch.title } : {}),
		};
		if (patch.target === null) delete next.target;
		else if (patch.target !== undefined) next.target = patch.target;
		this.commit(projectId, {
			projects: this.replaceProject(file, {
				...project,
				milestones: project.milestones.map((candidate) =>
					candidate.id === milestoneId ? next : candidate,
				),
				updatedAt: this.host.now(),
			}),
		});
		return next;
	}

	/** Deletes a milestone: its cards stay in the project without one. */
	deleteMilestone(projectId: string, milestoneId: string): { deleted: string } {
		this.host.project(projectId);
		const { file, project } = this.milestoneHolder(projectId, milestoneId);
		const cards = this.store.cards(projectId);
		const held = cards?.cards.filter((card) => card.milestoneId === milestoneId) ?? [];
		const at = this.host.now();
		this.commit(projectId, {
			projects: this.replaceProject(file, {
				...project,
				milestones: project.milestones.filter((candidate) => candidate.id !== milestoneId),
				updatedAt: at,
			}),
			...(cards && held.length > 0
				? {
						cards: this.replaceCards(
							cards,
							held.map((card) => {
								const { milestoneId: _milestone, ...rest } = card;
								return { ...rest, updatedAt: at };
							}),
						),
					}
				: {}),
		});
		return { deleted: milestoneId };
	}

	private writeCards(located: Located, changed: readonly Card[]): void {
		const file = this.store.cards(located.projectId) ?? located.file;
		this.commit(located.projectId, { cards: this.replaceCards(file, changed) });
	}

	/**
	 * Puts a card into one of its board's roadmap projects and milestones: a milestone alone names its
	 * project, `roadmapProjectId: null` takes it out of both, `milestoneId: null` out of the milestone.
	 */
	assignProject(
		cardId: string,
		roadmapProjectId?: string | null,
		milestoneId?: string | null,
	): Card {
		const located = this.host.locate(cardId);
		const { card } = located;
		if (roadmapProjectId === undefined && milestoneId === undefined)
			throw new Error("Pass the roadmapProjectId or the milestoneId.");
		const { roadmapProjectId: _project, milestoneId: _milestone, ...rest } = card;
		let next: Card = { ...rest, updatedAt: this.host.now() };
		if (roadmapProjectId === null) {
			if (milestoneId) throw new Error("A card outside every project has no milestone.");
		} else if (roadmapProjectId !== undefined) {
			const { project } = this.roadmapProject(located.projectId, roadmapProjectId);
			const keep = milestoneId === undefined ? card.milestoneId : (milestoneId ?? undefined);
			if (milestoneId && !project.milestones.some((milestone) => milestone.id === milestoneId))
				throw new Error(`${milestoneId} is not a milestone of ${roadmapProjectId}.`);
			const inProject = keep && project.milestones.some((milestone) => milestone.id === keep);
			next = { ...next, roadmapProjectId, ...(inProject ? { milestoneId: keep } : {}) };
		} else if (milestoneId === null) {
			next = {
				...next,
				...(card.roadmapProjectId ? { roadmapProjectId: card.roadmapProjectId } : {}),
			};
		} else if (milestoneId !== undefined) {
			const { project } = this.milestoneHolder(located.projectId, milestoneId);
			next = { ...next, roadmapProjectId: project.id, milestoneId };
		}
		this.writeCards(located, [next]);
		return next;
	}

	/** Pins a card's planned start on the step graph (an ISO date); a started card's start is its attempt's. */
	pin(cardId: string, start: string): Card {
		const located = this.host.locate(cardId);
		if (!isPinnable(located.card.category))
			throw new Error(`${located.card.id} has started; its start is its attempt's.`);
		const next: Card = { ...located.card, pinnedStart: start, updatedAt: this.host.now() };
		this.writeCards(located, [next]);
		return next;
	}

	unpin(cardId: string): Card {
		const located = this.host.locate(cardId);
		const { pinnedStart: _pinned, ...rest } = located.card;
		const next: Card = { ...rest, updatedAt: this.host.now() };
		this.writeCards(located, [next]);
		return next;
	}

	/**
	 * Moves a card's planned start by `days` (pinning it) and every pinned card it blocks, transitively, by
	 * the same; unpinned dependents follow by themselves, and started ones keep their actual start.
	 */
	shiftChain(cardId: string, days: number): Card[] {
		const located = this.host.locate(cardId);
		const { card } = located;
		if (!isPinnable(card.category))
			throw new Error(`${card.id} has started; its start is its attempt's.`);
		const data = this.data(located.projectId);
		const plan = scheduleOf(data, this.host.now());
		const slot = plan.nodes.find((node) => node.id === card.id);
		const start = card.pinnedStart
			? dayOfIso(card.pinnedStart)
			: Math.floor(slot?.start ?? today(this.host.now()));
		const at = this.host.now();
		const byId = new Map(data.cards.map((entry) => [entry.id, entry]));
		const moved: Card[] = [{ ...card, pinnedStart: isoOfDay(start + days), updatedAt: at }];
		for (const id of dependentsOf((entry) => byId.get(entry)?.blocks, card.id)) {
			const dependent = byId.get(id);
			if (!dependent?.pinnedStart || !isPinnable(dependent.category)) continue;
			moved.push({
				...dependent,
				pinnedStart: isoOfDay(dayOfIso(dependent.pinnedStart) + days),
				updatedAt: at,
			});
		}
		this.writeCards(located, moved);
		return moved;
	}

	/** The initiative's draft update (one at a time) set to `text` and `health`, created when it has none. */
	private drafted(
		projectId: string,
		initiativeId: string,
		text: string,
		health: Health,
		publish: boolean,
	): InitiativeUpdate {
		this.host.project(projectId);
		const { file, initiative } = this.initiative(projectId, initiativeId);
		const at = this.host.now();
		const draft = initiative.updates.find((update) => update.publishedAt === undefined);
		const update: InitiativeUpdate = {
			...(draft ?? { id: `U-${file.nextUpdateNumber}` }),
			at,
			text,
			health,
			...(publish ? { publishedAt: at } : {}),
		};
		const next: Initiative = {
			...initiative,
			updates: draft
				? initiative.updates.map((candidate) => (candidate.id === draft.id ? update : candidate))
				: [...initiative.updates, update],
			updatedAt: at,
		};
		this.commit(projectId, {
			initiatives: {
				...this.replaceInitiative(file, next),
				nextUpdateNumber: file.nextUpdateNumber + (draft ? 0 : 1),
			},
		});
		return update;
	}

	/** Saves the initiative's draft update, replacing an earlier draft's text and health; never publishes. */
	saveDraft(
		projectId: string,
		initiativeId: string,
		text: string,
		health: Health,
	): InitiativeUpdate {
		return this.drafted(projectId, initiativeId, text, health, false);
	}

	/** Publishes the draft update, with the human's last edits; without a draft, `text` makes one. */
	publishDraft(
		projectId: string,
		initiativeId: string,
		edits: { text?: string; health?: Health } = {},
	): InitiativeUpdate {
		this.host.project(projectId);
		const { initiative } = this.initiative(projectId, initiativeId);
		const draft = initiative.updates.find((update) => update.publishedAt === undefined);
		const text = edits.text ?? draft?.text;
		if (!text) throw new Error(`${initiativeId} has no draft update to publish.`);
		return this.drafted(
			projectId,
			initiativeId,
			text,
			edits.health ?? draft?.health ?? "on_track",
			true,
		);
	}

	/**
	 * The initiative each card of a board serves: its roadmap project's, else the first by rank of its board's
	 * listing it, else one on another board listing it as an external card.
	 */
	initiativesOf(
		projectId: string,
		cards: readonly Card[],
	): Map<string, { projectId: string; initiative: Initiative }> {
		const served = new Map<string, { projectId: string; initiative: Initiative }>();
		if (cards.length === 0) return served;
		const initiatives = [...this.store.initiatives(projectId).initiatives].sort(byRank);
		const projects = new Map(
			this.store.roadmapProjects(projectId).projects.map((project) => [project.id, project]),
		);
		const abroad = new Set<string>();
		for (const card of cards) {
			const via = card.roadmapProjectId
				? projects.get(card.roadmapProjectId)?.initiativeId
				: undefined;
			const own =
				initiatives.find((initiative) => initiative.id === via) ??
				initiatives.find((initiative) => initiative.cardIds.includes(card.id));
			if (own) served.set(card.id, { projectId, initiative: own });
			else abroad.add(card.id);
		}
		if (abroad.size === 0) return served;
		for (const other of this.store.projectIds()) {
			if (other === projectId) continue;
			let listing: Initiative[];
			try {
				listing = this.store.initiatives(other).initiatives;
			} catch {
				continue;
			}
			for (const initiative of listing)
				for (const ref of initiative.externalCards)
					if (abroad.has(ref.cardId) && !served.has(ref.cardId))
						served.set(ref.cardId, { projectId: other, initiative });
		}
		return served;
	}

	initiativeOfCard(
		projectId: string,
		card: Card,
	): { projectId: string; initiative: Initiative } | null {
		return this.initiativesOf(projectId, [card]).get(card.id) ?? null;
	}

	/** The kickoff's context of a card: its initiative's outcome and criteria, its project and milestone. */
	kickoffContext(projectId: string, card: Card): KickoffContext {
		const served = this.initiativeOfCard(projectId, card);
		const project = card.roadmapProjectId
			? this.store
					.roadmapProjects(projectId)
					.projects.find((candidate) => candidate.id === card.roadmapProjectId)
			: undefined;
		const milestone = project?.milestones.find((candidate) => candidate.id === card.milestoneId);
		return {
			...(served ? { initiative: served.initiative } : {}),
			...(project ? { project: project.title } : {}),
			...(milestone ? { milestone: milestone.title } : {}),
		};
	}

	/** Drops a deleted card from every initiative listing it, publishing the other boards that changed. */
	forgetCard(projectId: string, cardId: string): void {
		for (const board of this.store.projectIds()) {
			let file: InitiativesFile;
			try {
				file = this.store.initiatives(board);
			} catch {
				continue;
			}
			const holds = (initiative: Initiative) =>
				initiative.cardIds.includes(cardId) ||
				initiative.externalCards.some((ref) => ref.cardId === cardId);
			if (!file.initiatives.some(holds)) continue;
			this.store.saveInitiatives(board, {
				...file,
				initiatives: file.initiatives.map((initiative) =>
					holds(initiative)
						? {
								...initiative,
								cardIds: initiative.cardIds.filter((id) => id !== cardId),
								externalCards: initiative.externalCards.filter((ref) => ref.cardId !== cardId),
							}
						: initiative,
				),
			});
			if (board !== projectId) this.host.changed(board);
		}
	}
}
