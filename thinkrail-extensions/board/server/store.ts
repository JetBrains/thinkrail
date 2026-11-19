import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ExtensionLog } from "@thinkrail/extension-api/server";
import {
	type Attempt,
	type BoardSettings,
	CARD_SIZES,
	CARD_TYPES,
	CATEGORIES,
	type Card,
	DEFAULT_SETTINGS,
	PRESETS,
	type Transition,
	WORKFLOWS,
} from "./model";

export const STORE_VERSION = 1;
const CARDS = "cards.json";
const SETTINGS = "settings.json";
const TRANSITIONS = "transitions.jsonl";
const PROJECT_DIR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface CardsFile {
	version: typeof STORE_VERSION;
	prefix: string;
	nextNumber: number;
	cards: Card[];
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
	};
}

/** A stored card, defaults filled in; `null` when it lacks what identifies or places it. */
export function readCard(raw: unknown): Card | null {
	if (!isRecord(raw)) return null;
	const { id, title, category, column } = raw;
	if (typeof id !== "string" || typeof title !== "string" || typeof column !== "string")
		return null;
	if (!oneOf(CATEGORIES, category)) return null;
	const source = isRecord(raw.source) ? raw.source : {};
	const pending = isRecord(raw.cancelPending) ? raw.cancelPending : null;
	return {
		id,
		source: {
			kind: oneOf(["native", "task-spec", "github"] as const, source.kind) ? source.kind : "native",
			ref: typeof source.ref === "string" ? source.ref : id,
		},
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
		createdAt: finite(raw.createdAt, 0),
		updatedAt: finite(raw.updatedAt, 0),
		...(pending && typeof pending.workspaceId === "string"
			? { cancelPending: { workspaceId: pending.workspaceId, at: finite(pending.at, 0) } }
			: {}),
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
	return {
		preset: oneOf(PRESETS, raw.preset) ? raw.preset : DEFAULT_SETTINGS.preset,
		wipLimits: { needsYou: limit("needsYou"), review: limit("review"), agents: limit("agents") },
		followSelection: raw.followSelection === true,
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

	/** The projects with a board on disk. */
	projectIds(): string[] {
		try {
			return readdirSync(this.root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && PROJECT_DIR.test(entry.name))
				.filter((entry) => existsSync(join(this.root, entry.name, CARDS)))
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
				nextNumber: Math.max(1, Math.trunc(finite(raw.nextNumber, 1))),
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

	appendTransitions(projectId: string, transitions: readonly Transition[]): void {
		if (transitions.length === 0) return;
		const dir = this.dir(projectId);
		mkdirSync(dir, { recursive: true });
		appendFileSync(
			join(dir, TRANSITIONS),
			transitions.map((transition) => `${JSON.stringify(transition)}\n`).join(""),
		);
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
