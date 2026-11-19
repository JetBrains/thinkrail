import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ExtensionLog } from "@thinkrail/extension-api/server";
import { isIsoDate } from "./days";
import {
	type Attempt,
	type BoardSettings,
	CARD_SIZES,
	CARD_TYPES,
	CATEGORIES,
	type Card,
	type CardRef,
	type CardSource,
	DEFAULT_SETTINGS,
	GITHUB_FILTERS,
	HEALTHS,
	HORIZONS,
	type Initiative,
	type InitiativeUpdate,
	type Milestone,
	PRESETS,
	type RoadmapProject,
	type Transition,
	WORKFLOWS,
} from "./model";

export const STORE_VERSION = 1;
const CARDS = "cards.json";
const SETTINGS = "settings.json";
const TRANSITIONS = "transitions.jsonl";
const INITIATIVES = "initiatives.json";
const PROJECTS = "projects.json";
const PROJECT_DIR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface CardsFile {
	version: typeof STORE_VERSION;
	prefix: string;
	nextNumber: number;
	cards: Card[];
}

export interface InitiativesFile {
	version: typeof STORE_VERSION;
	nextNumber: number;
	nextUpdateNumber: number;
	initiatives: Initiative[];
}

export interface ProjectsFile {
	version: typeof STORE_VERSION;
	nextNumber: number;
	nextMilestoneNumber: number;
	projects: RoadmapProject[];
}

/** A board file written by a newer ThinkRail: read nothing, write nothing, rather than lose its data. */
export class NewerBoardStoreError extends Error {
	constructor(path: string) {
		super(`${path} was written by a newer ThinkRail; update ThinkRail to use this board.`);
	}
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
	typeof value === "string" && (values as readonly string[]).includes(value);
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const finite = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;
const positive = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;
const isoDate = (value: unknown): value is string => typeof value === "string" && isIsoDate(value);
const counter = (value: unknown) => Math.max(1, Math.trunc(finite(value, 1)));

function readAttempt(raw: unknown): Attempt | null {
	if (!isRecord(raw)) return null;
	const { workspaceId, sessionId, workflow } = raw;
	if (typeof workspaceId !== "string" || typeof sessionId !== "string") return null;
	if (!oneOf(WORKFLOWS, workflow)) return null;
	const notes = Array.isArray(raw.notes)
		? raw.notes.flatMap((note) =>
				isRecord(note) && typeof note.text === "string"
					? [{ text: note.text, at: finite(note.at, 0) }]
					: [],
			)
		: [];
	return {
		workspaceId,
		sessionId,
		workflow,
		startedAt: finite(raw.startedAt, 0),
		notes,
		...(raw.merged === true ? { merged: true as const } : {}),
		...(typeof raw.removedAt === "number" ? { removedAt: raw.removedAt } : {}),
		...(typeof raw.closesLinked === "number" ? { closesLinked: raw.closesLinked } : {}),
	};
}

/** A stored source; one missing what locates it reads as the card's own. */
function readSource(raw: unknown, id: string): CardSource {
	const source = isRecord(raw) ? raw : {};
	const ref = typeof source.ref === "string" ? source.ref : id;
	if (
		source.kind === "task-spec" &&
		typeof source.workspaceId === "string" &&
		typeof source.path === "string"
	)
		return { kind: "task-spec", ref, workspaceId: source.workspaceId, path: source.path };
	if (
		source.kind === "github" &&
		typeof source.number === "number" &&
		Number.isSafeInteger(source.number) &&
		typeof source.url === "string"
	)
		return { kind: "github", ref, number: source.number, url: source.url };
	return { kind: "native", ref: source.kind === "native" ? ref : id };
}

/** A stored card, defaults filled in; `null` when it lacks what identifies or places it. */
export function readCard(raw: unknown): Card | null {
	if (!isRecord(raw)) return null;
	const { id, title, category, column } = raw;
	if (typeof id !== "string" || typeof title !== "string" || typeof column !== "string")
		return null;
	if (!oneOf(CATEGORIES, category)) return null;
	const pending = isRecord(raw.cancelPending) ? raw.cancelPending : null;
	const origin = isRecord(raw.origin) ? raw.origin : null;
	return {
		id,
		source: readSource(raw.source, id),
		title,
		description: typeof raw.description === "string" ? raw.description : "",
		acceptance: strings(raw.acceptance),
		type: oneOf(CARD_TYPES, raw.type) ? raw.type : "feature",
		...(oneOf(CARD_SIZES, raw.size) ? { size: raw.size } : {}),
		...(raw.sizeSuggested === true ? { sizeSuggested: true } : {}),
		labels: strings(raw.labels),
		blocks: strings(raw.blocks),
		specRefs: strings(raw.specRefs),
		rank: finite(raw.rank, 0),
		category,
		column,
		ownerHuman: typeof raw.ownerHuman === "string" ? raw.ownerHuman : "",
		attempts: Array.isArray(raw.attempts)
			? raw.attempts.flatMap((attempt) => readAttempt(attempt) ?? [])
			: [],
		createdBy: raw.createdBy === "agent" ? "agent" : "human",
		...(origin && (typeof origin.sessionId === "string" || typeof origin.cardId === "string")
			? {
					origin: {
						...(typeof origin.sessionId === "string" ? { sessionId: origin.sessionId } : {}),
						...(typeof origin.cardId === "string" ? { cardId: origin.cardId } : {}),
					},
				}
			: {}),
		createdAt: finite(raw.createdAt, 0),
		updatedAt: finite(raw.updatedAt, 0),
		...(pending && typeof pending.workspaceId === "string"
			? { cancelPending: { workspaceId: pending.workspaceId, at: finite(pending.at, 0) } }
			: {}),
		...(typeof raw.projectId === "string" ? { projectId: raw.projectId } : {}),
		...(typeof raw.projectId === "string" && typeof raw.milestoneId === "string"
			? { milestoneId: raw.milestoneId }
			: {}),
		...(isoDate(raw.pinnedStart) ? { pinnedStart: raw.pinnedStart } : {}),
		...(positive(raw.estimateDays) ? { estimateDays: raw.estimateDays } : {}),
	};
}

function readUpdate(raw: unknown): InitiativeUpdate | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.text !== "string") return null;
	return {
		id: raw.id,
		at: finite(raw.at, 0),
		text: raw.text,
		health: oneOf(HEALTHS, raw.health) ? raw.health : "on_track",
		...(typeof raw.publishedAt === "number" ? { publishedAt: raw.publishedAt } : {}),
	};
}

function readCardRef(raw: unknown): CardRef | null {
	return isRecord(raw) && typeof raw.projectId === "string" && typeof raw.cardId === "string"
		? { projectId: raw.projectId, cardId: raw.cardId }
		: null;
}

/** A stored initiative, defaults filled in; `null` without an id or a title. */
export function readInitiative(raw: unknown): Initiative | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string") return null;
	const health = isRecord(raw.health) ? raw.health : null;
	const override = health && oneOf(HEALTHS, health.override) ? health.override : undefined;
	const note = health && typeof health.note === "string" ? health.note : undefined;
	return {
		id: raw.id,
		...(typeof raw.parentId === "string" ? { parentId: raw.parentId } : {}),
		title: raw.title,
		outcome: typeof raw.outcome === "string" ? raw.outcome : "",
		criteria: strings(raw.criteria),
		horizon: oneOf(HORIZONS, raw.horizon) ? raw.horizon : "later",
		rank: finite(raw.rank, 0),
		...(isoDate(raw.target) ? { target: raw.target } : {}),
		...(positive(raw.appetiteDays) ? { appetiteDays: raw.appetiteDays } : {}),
		specRefs: strings(raw.specRefs),
		...(override || note
			? { health: { ...(override ? { override } : {}), ...(note ? { note } : {}) } }
			: {}),
		updates: Array.isArray(raw.updates)
			? raw.updates.flatMap((update) => readUpdate(update) ?? [])
			: [],
		cardIds: strings(raw.cardIds),
		externalCards: Array.isArray(raw.externalCards)
			? raw.externalCards.flatMap((ref) => readCardRef(ref) ?? [])
			: [],
		...(raw.proposed === true ? { proposed: true as const } : {}),
		...(raw.proposedBy === "agent" ? { proposedBy: "agent" as const } : {}),
		createdAt: finite(raw.createdAt, 0),
		updatedAt: finite(raw.updatedAt, 0),
	};
}

function readMilestone(raw: unknown): Milestone | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string") return null;
	return { id: raw.id, title: raw.title, ...(isoDate(raw.target) ? { target: raw.target } : {}) };
}

/** A stored roadmap project, defaults filled in; `null` without an id or a title. */
export function readRoadmapProject(raw: unknown): RoadmapProject | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string") return null;
	return {
		id: raw.id,
		...(typeof raw.initiativeId === "string" ? { initiativeId: raw.initiativeId } : {}),
		title: raw.title,
		milestones: Array.isArray(raw.milestones)
			? raw.milestones.flatMap((milestone) => readMilestone(milestone) ?? [])
			: [],
		...(raw.proposed === true ? { proposed: true as const } : {}),
		...(raw.proposedBy === "agent" ? { proposedBy: "agent" as const } : {}),
		createdAt: finite(raw.createdAt, 0),
		updatedAt: finite(raw.updatedAt, 0),
	};
}

function readSettings(raw: Raw): BoardSettings {
	const limits = isRecord(raw.wipLimits) ? raw.wipLimits : {};
	const limit = (key: keyof BoardSettings["wipLimits"]) => {
		const value = limits[key];
		return typeof value === "number" && Number.isInteger(value) && value >= 0
			? value
			: DEFAULT_SETTINGS.wipLimits[key];
	};
	const github = isRecord(raw.github) ? raw.github : {};
	return {
		preset: oneOf(PRESETS, raw.preset) ? raw.preset : DEFAULT_SETTINGS.preset,
		wipLimits: { needsYou: limit("needsYou"), review: limit("review"), agents: limit("agents") },
		followSelection: raw.followSelection === true,
		github: {
			enabled: github.enabled === true,
			filter: oneOf(GITHUB_FILTERS, github.filter) ? github.filter : DEFAULT_SETTINGS.github.filter,
		},
	};
}

function writeAtomic(path: string, value: unknown): void {
	const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`);
	renameSync(temporary, path);
}

/**
 * The board's files under the extension's data folder, one folder per project. The host runs one board
 * per process, so this is the single writer and keeps what it read in memory.
 */
export class BoardStore {
	private readonly cardsByProject = new Map<string, CardsFile | null>();
	private readonly settingsByProject = new Map<string, BoardSettings>();
	private readonly initiativesByProject = new Map<string, InitiativesFile>();
	private readonly projectsByProject = new Map<string, ProjectsFile>();
	private readonly root: string;
	private readonly log: ExtensionLog;
	private readonly now: () => number;

	constructor(root: string, log: ExtensionLog, now: () => number = Date.now) {
		this.root = root;
		this.log = log;
		this.now = now;
	}

	private dir(projectId: string): string {
		if (!PROJECT_DIR.test(projectId)) throw new Error(`Not a project id: ${projectId}`);
		return join(this.root, projectId);
	}

	/** The projects with a board (cards or initiatives) on disk. */
	projectIds(): string[] {
		try {
			return readdirSync(this.root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && PROJECT_DIR.test(entry.name))
				.filter((entry) =>
					[CARDS, INITIATIVES].some((name) => existsSync(join(this.root, entry.name, name))),
				)
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	}

	private readVersioned(path: string): Raw | null {
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			return null;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = undefined;
		}
		if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > STORE_VERSION)
			throw new NewerBoardStoreError(path);
		if (isRecord(parsed) && parsed.version === STORE_VERSION) return parsed;
		this.quarantine(path);
		return null;
	}

	private quarantine(path: string): void {
		const aside = `${path}.corrupt-${this.now()}`;
		try {
			renameSync(path, aside);
			this.log.warn(`unreadable board file moved aside to ${aside}`);
		} catch (error) {
			this.log.warn(`unreadable board file ${path} could not be moved aside`, error);
		}
	}

	/** `null` for a project without a board yet (or whose unreadable file was just moved aside). */
	cards(projectId: string): CardsFile | null {
		if (this.cardsByProject.has(projectId)) return this.cardsByProject.get(projectId) ?? null;
		const path = join(this.dir(projectId), CARDS);
		const raw = this.readVersioned(path);
		let file: CardsFile | null = null;
		if (raw && typeof raw.prefix === "string" && Array.isArray(raw.cards)) {
			const cards = raw.cards.flatMap((card) => readCard(card) ?? []);
			if (cards.length !== raw.cards.length)
				this.log.warn(`dropped ${raw.cards.length - cards.length} unreadable card(s) of ${path}`);
			file = {
				version: STORE_VERSION,
				prefix: raw.prefix,
				nextNumber: counter(raw.nextNumber),
				cards,
			};
		} else if (raw) this.quarantine(path);
		this.cardsByProject.set(projectId, file);
		return file;
	}

	saveCards(projectId: string, file: CardsFile): void {
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		writeAtomic(join(dir, CARDS), file);
		this.cardsByProject.set(projectId, file);
	}

	settings(projectId: string): BoardSettings {
		const cached = this.settingsByProject.get(projectId);
		if (cached) return cached;
		const raw = this.readVersioned(join(this.dir(projectId), SETTINGS));
		const settings = raw ? readSettings(raw) : DEFAULT_SETTINGS;
		this.settingsByProject.set(projectId, settings);
		return settings;
	}

	saveSettings(projectId: string, settings: BoardSettings): void {
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		writeAtomic(join(dir, SETTINGS), { version: STORE_VERSION, ...settings });
		this.settingsByProject.set(projectId, settings);
	}

	/** The project's initiatives; none until the first is created (or once an unreadable file moved aside). */
	initiatives(projectId: string): InitiativesFile {
		const cached = this.initiativesByProject.get(projectId);
		if (cached) return cached;
		const path = join(this.dir(projectId), INITIATIVES);
		const raw = this.readVersioned(path);
		if (raw && !Array.isArray(raw.initiatives)) this.quarantine(path);
		const list = raw && Array.isArray(raw.initiatives) ? raw.initiatives : [];
		const initiatives = list.flatMap((initiative) => readInitiative(initiative) ?? []);
		if (initiatives.length !== list.length)
			this.log.warn(
				`dropped ${list.length - initiatives.length} unreadable initiative(s) of ${path}`,
			);
		const file: InitiativesFile = {
			version: STORE_VERSION,
			nextNumber: counter(raw?.nextNumber),
			nextUpdateNumber: counter(raw?.nextUpdateNumber),
			initiatives,
		};
		this.initiativesByProject.set(projectId, file);
		return file;
	}

	saveInitiatives(projectId: string, file: InitiativesFile): void {
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		writeAtomic(join(dir, INITIATIVES), file);
		this.initiativesByProject.set(projectId, file);
	}

	/** The project's roadmap projects and their milestones. */
	roadmapProjects(projectId: string): ProjectsFile {
		const cached = this.projectsByProject.get(projectId);
		if (cached) return cached;
		const path = join(this.dir(projectId), PROJECTS);
		const raw = this.readVersioned(path);
		if (raw && !Array.isArray(raw.projects)) this.quarantine(path);
		const list = raw && Array.isArray(raw.projects) ? raw.projects : [];
		const projects = list.flatMap((project) => readRoadmapProject(project) ?? []);
		if (projects.length !== list.length)
			this.log.warn(`dropped ${list.length - projects.length} unreadable project(s) of ${path}`);
		const file: ProjectsFile = {
			version: STORE_VERSION,
			nextNumber: counter(raw?.nextNumber),
			nextMilestoneNumber: counter(raw?.nextMilestoneNumber),
			projects,
		};
		this.projectsByProject.set(projectId, file);
		return file;
	}

	saveRoadmapProjects(projectId: string, file: ProjectsFile): void {
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		writeAtomic(join(dir, PROJECTS), file);
		this.projectsByProject.set(projectId, file);
	}

	appendTransitions(projectId: string, transitions: readonly Transition[]): void {
		if (transitions.length === 0) return;
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		appendFileSync(
			join(dir, TRANSITIONS),
			transitions.map((transition) => `${JSON.stringify(transition)}\n`).join(""),
		);
	}

	/** Writes a short-lived file into the project's folder (a PR body `gh` reads); returns its path. */
	writeScratch(projectId: string, name: string, text: string): string {
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, name);
		writeFileSync(path, text);
		return path;
	}

	removeScratch(path: string): void {
		rmSync(path, { force: true });
	}

	/** The project's transition log, oldest first; a line that does not parse is skipped. */
	transitions(projectId: string): Transition[] {
		let text: string;
		try {
			text = readFileSync(join(this.dir(projectId), TRANSITIONS), "utf8");
		} catch {
			return [];
		}
		return text.split("\n").flatMap((line) => {
			if (!line.trim()) return [];
			try {
				const parsed: unknown = JSON.parse(line);
				return isRecord(parsed) && typeof parsed.cardId === "string"
					? [parsed as unknown as Transition]
					: [];
			} catch {
				return [];
			}
		});
	}
}
