import type { ExtensionQuery, ThinkingLevel } from "@thinkrail/extension-api/server";
import type { Board, CardInput, CardPatch, SettingsPatch, StartOptions } from "./board";
import { isIsoDate } from "./days";
import {
	type IdeaPatch,
	QUOTE_MAX,
	REF_MAX,
	type ScoreInput,
	type WatchInput,
	type WatchPatch,
} from "./discovery";
import { INSIGHTS_MAX_WEEKS } from "./insights";
import { DISCOVERY_CHATS, ROADMAP_CHATS } from "./kickoff";
import {
	CARD_SIZES,
	CARD_TYPES,
	EVIDENCE_KINDS,
	GITHUB_FILTERS,
	type GithubSettings,
	HEALTHS,
	HORIZONS,
	PRESETS,
	TEXT_MAX,
	TITLE_MAX,
	WORKFLOWS,
} from "./model";
import type {
	InitiativeInput,
	InitiativePatch,
	MilestoneInput,
	MilestonePatch,
	ProjectInput,
	ProjectPatch,
} from "./roadmap";

const ITEM_MAX = 1_000;
const CARD_ID_MAX = 300;
const LIST_MAX = 100;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const ENTITY_ID_MAX = 40;
const ESTIMATE_MAX_DAYS = 365;
const APPETITE_MAX_DAYS = 3650;
const SHIFT_MAX_DAYS = 365;
const MILESTONES_MAX = 50;
const PATH_MAX = 400;
const DEFAULT_INSIGHT_WEEKS = 12;

type Params = Record<string, unknown>;

function params(value: unknown): Params {
	if (value === undefined) return {};
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("The board's queries take an object of params.");
	return value as Params;
}

function text(p: Params, key: string, max: number): string {
	const value = p[key];
	if (typeof value !== "string" || !value.trim()) throw new Error(`Pass a non-empty ${key}.`);
	if (value.length > max) throw new Error(`${key} is longer than ${max} characters.`);
	return value.trim();
}

function optionalText(p: Params, key: string, max: number): string | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${key} must be a string.`);
	if (value.length > max) throw new Error(`${key} is longer than ${max} characters.`);
	return value.trim();
}

function optionalList(p: Params, key: string): string[] | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (
		!Array.isArray(value) ||
		value.length > LIST_MAX ||
		!value.every((item) => typeof item === "string" && item.length <= ITEM_MAX)
	)
		throw new Error(`${key} must be a list of at most ${LIST_MAX} strings.`);
	return value.map((item: string) => item.trim()).filter(Boolean);
}

function optionalOneOf<T extends string>(
	p: Params,
	key: string,
	values: readonly T[],
): T | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !(values as readonly string[]).includes(value))
		throw new Error(`${key} must be one of ${values.join(", ")}.`);
	return value as T;
}

function optionalBoolean(p: Params, key: string): boolean | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${key} must be true or false.`);
	return value;
}

function optionalNumber(p: Params, key: string): number | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${key} must be a number.`);
	return value;
}

function optionalDate(p: Params, key: string): string | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !isIsoDate(value))
		throw new Error(`${key} must be a date written YYYY-MM-DD.`);
	return value;
}

function optionalDays(p: Params, key: string, max: number): number | undefined {
	const value = optionalNumber(p, key);
	if (value !== undefined && (value <= 0 || value > max))
		throw new Error(`${key} must be more than 0 and at most ${max} days.`);
	return value;
}

/** A param that `null` clears: `null`, else what `read` makes of it. */
function nullable<T>(p: Params, key: string, read: (p: Params, key: string) => T): T | null {
	return p[key] === null ? null : read(p, key);
}

function onlyFalse(p: Params, key: string): false | undefined {
	if (p[key] === undefined) return undefined;
	if (p[key] !== false) throw new Error(`${key} can only be cleared (false).`);
	return false;
}

function record(p: Params, key: string): Params | undefined {
	const value = p[key];
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${key} must be an object.`);
	return value as Params;
}

/** Drops the absent keys, so an omitted param stays omitted rather than `undefined`. */
function defined<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function cardInput(p: Params): CardInput {
	return defined<CardInput>({
		title: text(p, "title", TITLE_MAX),
		description: optionalText(p, "description", TEXT_MAX),
		acceptance: optionalList(p, "acceptance"),
		type: optionalOneOf(p, "type", CARD_TYPES),
		size: optionalOneOf(p, "size", CARD_SIZES),
		labels: optionalList(p, "labels"),
		specRefs: optionalList(p, "specRefs"),
		column: optionalText(p, "column", 100),
	});
}

function cardPatch(p: Params): CardPatch {
	const size = p.size === null ? null : optionalOneOf(p, "size", CARD_SIZES);
	if (p.cancelPending !== undefined && p.cancelPending !== false)
		throw new Error("cancelPending can only be dismissed (false).");
	const title = p.title === undefined ? undefined : text(p, "title", TITLE_MAX);
	return defined<CardPatch>({
		title,
		description: optionalText(p, "description", TEXT_MAX),
		acceptance: optionalList(p, "acceptance"),
		type: optionalOneOf(p, "type", CARD_TYPES),
		size,
		labels: optionalList(p, "labels"),
		specRefs: optionalList(p, "specRefs"),
		blocks: optionalList(p, "blocks"),
		cancelPending: p.cancelPending === false ? (false as const) : undefined,
		estimateDays: nullable(p, "estimateDays", (q, key) => optionalDays(q, key, ESTIMATE_MAX_DAYS)),
	});
}

function initiativeInput(p: Params): InitiativeInput {
	return defined<InitiativeInput>({
		title: text(p, "title", TITLE_MAX),
		outcome: optionalText(p, "outcome", TEXT_MAX),
		criteria: optionalList(p, "criteria"),
		horizon: optionalOneOf(p, "horizon", HORIZONS),
		parentId: optionalText(p, "parentId", ENTITY_ID_MAX) || undefined,
		target: optionalDate(p, "target"),
		appetiteDays: optionalDays(p, "appetiteDays", APPETITE_MAX_DAYS),
		specRefs: optionalList(p, "specRefs"),
	});
}

function initiativePatch(p: Params): InitiativePatch {
	const health = record(p, "health");
	return defined<InitiativePatch>({
		title: p.title === undefined ? undefined : text(p, "title", TITLE_MAX),
		outcome: optionalText(p, "outcome", TEXT_MAX),
		criteria: optionalList(p, "criteria"),
		horizon: optionalOneOf(p, "horizon", HORIZONS),
		parentId: nullable(p, "parentId", (q, key) => optionalText(q, key, ENTITY_ID_MAX) || undefined),
		target: nullable(p, "target", optionalDate),
		appetiteDays: nullable(p, "appetiteDays", (q, key) => optionalDays(q, key, APPETITE_MAX_DAYS)),
		specRefs: optionalList(p, "specRefs"),
		health: health
			? defined<NonNullable<InitiativePatch["health"]>>({
					override: nullable(health, "override", (q, key) => optionalOneOf(q, key, HEALTHS)),
					note: nullable(health, "note", (q, key) => optionalText(q, key, ITEM_MAX)),
				})
			: undefined,
		proposed: onlyFalse(p, "proposed"),
	});
}

function milestoneInput(p: Params): MilestoneInput {
	return defined<MilestoneInput>({
		title: text(p, "title", TITLE_MAX),
		target: optionalDate(p, "target"),
	});
}

function milestonePatch(p: Params): MilestonePatch {
	return defined<MilestonePatch>({
		title: p.title === undefined ? undefined : text(p, "title", TITLE_MAX),
		target: nullable(p, "target", optionalDate),
	});
}

function projectInput(p: Params): ProjectInput {
	const raw = p.milestones;
	if (raw !== undefined && (!Array.isArray(raw) || raw.length > MILESTONES_MAX))
		throw new Error(`milestones must be a list of at most ${MILESTONES_MAX}.`);
	return defined<ProjectInput>({
		title: text(p, "title", TITLE_MAX),
		initiativeId: optionalText(p, "initiativeId", ENTITY_ID_MAX) || undefined,
		milestones: raw?.map((milestone: unknown) => milestoneInput(params(milestone))),
	});
}

function projectPatch(p: Params): ProjectPatch {
	return defined<ProjectPatch>({
		title: p.title === undefined ? undefined : text(p, "title", TITLE_MAX),
		initiativeId: nullable(
			p,
			"initiativeId",
			(q, key) => optionalText(q, key, ENTITY_ID_MAX) || undefined,
		),
		proposed: onlyFalse(p, "proposed"),
	});
}

function scoreInput(p: Params, key: string): ScoreInput | undefined {
	const score = record(p, key);
	if (!score) return undefined;
	const value = score.score;
	if (typeof value !== "number") throw new Error(`${key}.score must be a number.`);
	return defined<ScoreInput>({ score: value, reasons: optionalList(score, "reasons") });
}

function ideaPatch(p: Params): IdeaPatch {
	return defined<IdeaPatch>({
		title: p.title === undefined ? undefined : text(p, "title", TITLE_MAX),
		pitch: optionalText(p, "pitch", TEXT_MAX),
		value: nullable(p, "value", scoreInput),
		effort: nullable(p, "effort", scoreInput),
		dismissed: optionalBoolean(p, "dismissed"),
	});
}

function watchInput(p: Params): WatchInput {
	return defined<WatchInput>({
		name: text(p, "name", TITLE_MAX),
		urls: optionalList(p, "urls"),
		notes: optionalText(p, "notes", TEXT_MAX),
	});
}

function watchPatch(p: Params): WatchPatch {
	return defined<WatchPatch>({
		name: p.name === undefined ? undefined : text(p, "name", TITLE_MAX),
		urls: optionalList(p, "urls"),
		notes: optionalText(p, "notes", TEXT_MAX),
	});
}

function requiredOneOf<T extends string>(p: Params, key: string, values: readonly T[]): T {
	const value = optionalOneOf(p, key, values);
	if (value === undefined) throw new Error(`Pass a ${key}: one of ${values.join(", ")}.`);
	return value;
}

function shiftDays(p: Params): number {
	const days = p.days;
	if (
		typeof days !== "number" ||
		!Number.isInteger(days) ||
		days === 0 ||
		Math.abs(days) > SHIFT_MAX_DAYS
	)
		throw new Error(
			`days must be a whole number of days, not 0, at most ${SHIFT_MAX_DAYS} either way.`,
		);
	return days;
}

function insightWeeks(p: Params): number {
	const weeks = p.weeks ?? DEFAULT_INSIGHT_WEEKS;
	if (
		typeof weeks !== "number" ||
		!Number.isInteger(weeks) ||
		weeks < 1 ||
		weeks > INSIGHTS_MAX_WEEKS
	)
		throw new Error(`weeks must be a whole number from 1 to ${INSIGHTS_MAX_WEEKS}.`);
	return weeks;
}

function startOptions(p: Params): StartOptions {
	return defined<StartOptions>({
		workflow: optionalOneOf(p, "workflow", WORKFLOWS),
		model: optionalText(p, "model", 300) || undefined,
		thinkingLevel: optionalOneOf<ThinkingLevel>(p, "thinkingLevel", THINKING_LEVELS),
		baseRef: optionalText(p, "baseRef", 300) || undefined,
	});
}

function settingsPatch(p: Params): SettingsPatch {
	const raw = p.wipLimits;
	let wipLimits: SettingsPatch["wipLimits"];
	if (raw !== undefined) {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			throw new Error("wipLimits must be an object.");
		wipLimits = {};
		for (const key of ["needsYou", "review", "agents"] as const) {
			const value = (raw as Params)[key];
			if (value === undefined) continue;
			if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 99)
				throw new Error(`wipLimits.${key} must be a whole number from 0 to 99.`);
			wipLimits[key] = value;
		}
	}
	return defined<SettingsPatch>({
		preset: optionalOneOf(p, "preset", PRESETS),
		wipLimits,
		followSelection: optionalBoolean(p, "followSelection"),
	});
}

function githubPatch(p: Params): Partial<GithubSettings> {
	const patch = defined<Partial<GithubSettings>>({
		enabled: optionalBoolean(p, "enabled"),
		filter: optionalOneOf(p, "filter", GITHUB_FILTERS),
	});
	if (Object.keys(patch).length === 0) throw new Error("Pass enabled or filter.");
	return patch;
}

function cardIds(p: Params, purpose = "accept"): string[] {
	const ids = optionalList(p, "cardIds");
	if (!ids || ids.length === 0) throw new Error(`Pass the cardIds to ${purpose}.`);
	return ids;
}

/** The board's `extension.query` methods: each validates its params and answers JSON. */
export function boardQueries(board: Board): Readonly<Record<string, ExtensionQuery>> {
	const projectId = (p: Params) => text(p, "projectId", 200);
	const cardId = (p: Params) => text(p, "cardId", CARD_ID_MAX);
	/** The board of a source's card (`#12`) that is not stored yet. */
	const boardOf = (p: Params) => optionalText(p, "projectId", 200) || undefined;
	const initiativeId = (p: Params) => text(p, "initiativeId", ENTITY_ID_MAX);
	const roadmapProjectId = (p: Params) => text(p, "roadmapProjectId", ENTITY_ID_MAX);
	const milestoneId = (p: Params) => text(p, "milestoneId", ENTITY_ID_MAX);
	const ideaId = (p: Params) => text(p, "ideaId", ENTITY_ID_MAX);
	const watchId = (p: Params) => text(p, "watchId", ENTITY_ID_MAX);
	const { roadmap, discovery } = board;
	return {
		"board.get": (raw) => board.get(projectId(params(raw))),
		inbox: (raw) => {
			params(raw);
			return board.inbox();
		},
		"card.get": (raw) => {
			const p = params(raw);
			return board.card(cardId(p), boardOf(p));
		},
		"card.create": (raw) => {
			const p = params(raw);
			return board.createCard(projectId(p), cardInput(p), "human");
		},
		"card.update": (raw) => {
			const p = params(raw);
			return board.updateCard(cardId(p), cardPatch(p), boardOf(p));
		},
		"card.move": (raw) => {
			const p = params(raw);
			return board.moveCard(
				cardId(p),
				text(p, "column", 100),
				optionalNumber(p, "rank"),
				boardOf(p),
			);
		},
		"card.delete": (raw) => board.deleteCard(cardId(params(raw))),
		"triage.accept": (raw) => board.acceptTriage(cardIds(params(raw))),
		"card.start": (raw) => {
			const p = params(raw);
			return board.startCard(cardId(p), startOptions(p), boardOf(p));
		},
		"card.adopt": (raw) => board.adoptTaskSpec(cardId(params(raw))),
		"card.deferrals": (raw) => {
			const p = params(raw);
			return board.sendDeferrals(cardId(p), text(p, "specId", CARD_ID_MAX));
		},
		"github.set": (raw) => {
			const p = params(raw);
			return board.setGithub(projectId(p), githubPatch(p));
		},
		"github.refresh": (raw) => board.refreshIssues(projectId(params(raw))),
		"openspec.validate": (raw) => {
			const p = params(raw);
			return board.validateChange(cardId(p), boardOf(p));
		},
		"openspec.archive": (raw) => {
			const p = params(raw);
			return board.archiveChange(cardId(p), boardOf(p));
		},
		"openspec.propose": (raw) => {
			const p = params(raw);
			return board.proposeChange(projectId(p), text(p, "description", TEXT_MAX));
		},
		"models.list": async (raw) => {
			params(raw);
			return { models: await board.host.models() };
		},
		"settings.get": (raw) => board.settings(projectId(params(raw))),
		"settings.update": (raw) => {
			const p = params(raw);
			return board.updateSettings(projectId(p), settingsPatch(p));
		},
		"roadmap.get": (raw) => roadmap.get(projectId(params(raw))),
		"roadmap.publish": (raw) => {
			const p = params(raw);
			return board.publishSnapshot(projectId(p), optionalText(p, "path", PATH_MAX) || undefined);
		},
		"insights.get": (raw) => {
			const p = params(raw);
			return roadmap.insights(projectId(p), insightWeeks(p));
		},
		"roadmap.chat": (raw) => {
			const p = params(raw);
			return board.startRoadmapChat(
				projectId(p),
				requiredOneOf(p, "kind", ROADMAP_CHATS),
				optionalText(p, "initiativeId", ENTITY_ID_MAX) || undefined,
			);
		},
		"initiative.create": (raw) => {
			const p = params(raw);
			return roadmap.createInitiative(projectId(p), initiativeInput(p), "human");
		},
		"initiative.update": (raw) => {
			const p = params(raw);
			return roadmap.updateInitiative(projectId(p), initiativeId(p), initiativePatch(p));
		},
		"initiative.delete": (raw) => {
			const p = params(raw);
			return roadmap.deleteInitiative(projectId(p), initiativeId(p));
		},
		"initiative.move": (raw) => {
			const p = params(raw);
			return roadmap.moveInitiative(
				projectId(p),
				initiativeId(p),
				requiredOneOf(p, "horizon", HORIZONS),
				optionalNumber(p, "rank"),
			);
		},
		"initiative.addCards": (raw) => {
			const p = params(raw);
			return roadmap.addCards(projectId(p), initiativeId(p), cardIds(p, "add"));
		},
		"initiative.removeCards": (raw) => {
			const p = params(raw);
			return roadmap.removeCards(projectId(p), initiativeId(p), cardIds(p, "remove"));
		},
		"initiative.updateDraft.save": (raw) => {
			const p = params(raw);
			return roadmap.saveDraft(
				projectId(p),
				initiativeId(p),
				text(p, "text", TEXT_MAX),
				requiredOneOf(p, "health", HEALTHS),
			);
		},
		"initiative.updateDraft.publish": (raw) => {
			const p = params(raw);
			return roadmap.publishDraft(
				projectId(p),
				initiativeId(p),
				defined<{ text?: string; health?: (typeof HEALTHS)[number] }>({
					text: optionalText(p, "text", TEXT_MAX) || undefined,
					health: optionalOneOf(p, "health", HEALTHS),
				}),
			);
		},
		"project.create": (raw) => {
			const p = params(raw);
			return roadmap.createProject(projectId(p), projectInput(p), "human");
		},
		"project.update": (raw) => {
			const p = params(raw);
			return roadmap.updateProject(projectId(p), roadmapProjectId(p), projectPatch(p));
		},
		"project.delete": (raw) => {
			const p = params(raw);
			return roadmap.deleteProject(projectId(p), roadmapProjectId(p));
		},
		"milestone.create": (raw) => {
			const p = params(raw);
			return roadmap.createMilestone(projectId(p), roadmapProjectId(p), milestoneInput(p));
		},
		"milestone.update": (raw) => {
			const p = params(raw);
			return roadmap.updateMilestone(projectId(p), milestoneId(p), milestonePatch(p));
		},
		"milestone.delete": (raw) => {
			const p = params(raw);
			return roadmap.deleteMilestone(projectId(p), milestoneId(p));
		},
		"card.assignProject": (raw) => {
			const p = params(raw);
			const entity = (q: Params, key: string) => optionalText(q, key, ENTITY_ID_MAX) || undefined;
			return roadmap.assignProject(
				cardId(p),
				nullable(p, "roadmapProjectId", entity),
				nullable(p, "milestoneId", entity),
			);
		},
		"card.link": (raw) => {
			const p = params(raw);
			return board.link(text(p, "from", CARD_ID_MAX), [text(p, "to", CARD_ID_MAX)]);
		},
		"card.unlink": (raw) => {
			const p = params(raw);
			return board.unlink(text(p, "from", CARD_ID_MAX), text(p, "to", CARD_ID_MAX));
		},
		"card.pin": (raw) => {
			const p = params(raw);
			const start = optionalDate(p, "start");
			if (!start) throw new Error("Pass the start, a date written YYYY-MM-DD.");
			return roadmap.pin(cardId(p), start);
		},
		"card.unpin": (raw) => roadmap.unpin(cardId(params(raw))),
		"discovery.get": (raw) => discovery.get(projectId(params(raw))),
		"discovery.chat": (raw) => {
			const p = params(raw);
			return board.startDiscoveryChat(
				projectId(p),
				requiredOneOf(p, "kind", DISCOVERY_CHATS),
				defined<{ ideaId?: string; watchId?: string }>({
					ideaId: optionalText(p, "ideaId", ENTITY_ID_MAX) || undefined,
					watchId: optionalText(p, "watchId", ENTITY_ID_MAX) || undefined,
				}),
			);
		},
		"idea.create": (raw) => {
			const p = params(raw);
			return discovery.createIdea(
				projectId(p),
				defined<{ title: string; pitch?: string }>({
					title: text(p, "title", TITLE_MAX),
					pitch: optionalText(p, "pitch", TEXT_MAX),
				}),
			);
		},
		"idea.update": (raw) => {
			const p = params(raw);
			return discovery.updateIdea(projectId(p), ideaId(p), ideaPatch(p));
		},
		"idea.delete": (raw) => {
			const p = params(raw);
			return discovery.deleteIdea(projectId(p), ideaId(p));
		},
		"idea.addEvidence": (raw) => {
			const p = params(raw);
			return discovery.addEvidence(
				projectId(p),
				ideaId(p),
				defined<{
					kind: (typeof EVIDENCE_KINDS)[number];
					ref: string;
					quote?: string;
					workspaceId?: string;
				}>({
					kind: requiredOneOf(p, "kind", EVIDENCE_KINDS),
					ref: text(p, "ref", REF_MAX),
					quote: optionalText(p, "quote", QUOTE_MAX) || undefined,
					workspaceId: optionalText(p, "workspaceId", 200) || undefined,
				}),
				"human",
			);
		},
		"idea.removeEvidence": (raw) => {
			const p = params(raw);
			return discovery.removeEvidence(
				projectId(p),
				ideaId(p),
				text(p, "evidenceId", ENTITY_ID_MAX),
			);
		},
		"idea.promote": (raw) => {
			const p = params(raw);
			return board.promoteIdea(projectId(p), ideaId(p));
		},
		"watchlist.create": (raw) => {
			const p = params(raw);
			return discovery.createWatch(projectId(p), watchInput(p));
		},
		"watchlist.update": (raw) => {
			const p = params(raw);
			return discovery.updateWatch(projectId(p), watchId(p), watchPatch(p));
		},
		"watchlist.delete": (raw) => {
			const p = params(raw);
			return discovery.deleteWatch(projectId(p), watchId(p));
		},
		"card.shiftChain": (raw) => {
			const p = params(raw);
			return roadmap.shiftChain(cardId(p), shiftDays(p));
		},
	};
}
