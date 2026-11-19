import type { ExtensionQuery, ThinkingLevel } from "@thinkrail/extension-api/server";
import type { Board, CardInput, CardPatch, SettingsPatch, StartOptions } from "./board";
import {
	CARD_SIZES,
	CARD_TYPES,
	GITHUB_FILTERS,
	type GithubSettings,
	PRESETS,
	TEXT_MAX,
	TITLE_MAX,
	WORKFLOWS,
} from "./model";

const ITEM_MAX = 1_000;
const CARD_ID_MAX = 300;
const LIST_MAX = 100;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

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
	});
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

function cardIds(p: Params): string[] {
	const ids = optionalList(p, "cardIds");
	if (!ids || ids.length === 0) throw new Error("Pass the cardIds to accept.");
	return ids;
}

/** The board's `extension.query` methods: each validates its params and answers JSON. */
export function boardQueries(board: Board): Readonly<Record<string, ExtensionQuery>> {
	const projectId = (p: Params) => text(p, "projectId", 200);
	const cardId = (p: Params) => text(p, "cardId", CARD_ID_MAX);
	/** The board of a source's card (`#12`) that is not stored yet. */
	const boardOf = (p: Params) => optionalText(p, "projectId", 200) || undefined;
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
		"models.list": async (raw) => {
			params(raw);
			return { models: await board.host.models() };
		},
		"settings.get": (raw) => board.settings(projectId(params(raw))),
		"settings.update": (raw) => {
			const p = params(raw);
			return board.updateSettings(projectId(p), settingsPatch(p));
		},
	};
}
