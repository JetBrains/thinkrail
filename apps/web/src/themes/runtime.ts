import {
	type ThemePreference as ConfigThemePreference,
	DEFAULT_CONFIG,
	isSystemThemePair,
	isThemeMode,
	normalizeThemePreference as normalizeConfigThemePreference,
	type SystemThemePair,
	type ThemeId,
} from "@thinkrail/contracts";
import {
	asStablePreferenceAdapter,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import {
	ANSI_COLOR_KEYS,
	type AnsiColorKey,
	assertThemeManifest,
	isThemeIdSlug,
	SYNTAX_COLOR_KEYS,
	type SyntaxColorKey,
	THEME_COLOR_KEYS,
	type ThemeAppearance,
	type ThemeContrast,
	type ThemeManifest,
} from "./schema";

export interface ThemeDescriptor {
	readonly id: ThemeId;
	readonly label: string;
	readonly order: number;
	readonly appearance: ThemeAppearance;
	readonly contrast: ThemeContrast;
}

export interface ThemeCatalog {
	readonly byId: ReadonlyMap<ThemeId, ThemeManifest>;
	readonly list: readonly ThemeDescriptor[];
}

export type ThemePreference = ConfigThemePreference;

export interface ThemeResolution {
	readonly requestedId: ThemeId;
	readonly theme: ThemeDescriptor;
	readonly fallback: boolean;
	readonly systemAppearance: ThemeAppearance | null;
}

interface ColorSchemeMediaQuery {
	readonly matches: boolean;
	addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
	removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

const HINT_KEY = `${STORAGE_PREFIX}theme`;
const HINT_VERSION = 1;
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

const paletteVariable = (key: string) =>
	`--${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

const ANSI_VARIABLES: Record<AnsiColorKey, string> = {
	black: "--ansi-black",
	red: "--ansi-red",
	green: "--ansi-green",
	yellow: "--ansi-yellow",
	blue: "--ansi-blue",
	magenta: "--ansi-magenta",
	cyan: "--ansi-cyan",
	white: "--ansi-white",
	brightBlack: "--ansi-bright-black",
	brightRed: "--ansi-bright-red",
	brightGreen: "--ansi-bright-green",
	brightYellow: "--ansi-bright-yellow",
	brightBlue: "--ansi-bright-blue",
	brightMagenta: "--ansi-bright-magenta",
	brightCyan: "--ansi-bright-cyan",
	brightWhite: "--ansi-bright-white",
};

export const SYNTAX_VARIABLES: Record<SyntaxColorKey, string> = {
	foreground: "--code-foreground",
	comment: "--code-comment",
	commentDoc: "--code-comment-doc",
	keyword: "--code-keyword",
	string: "--code-string",
	number: "--code-number",
	regexp: "--code-regexp",
	annotation: "--code-annotation",
	tag: "--code-tag",
	attributeName: "--code-attribute-name",
	attributeValue: "--code-attribute-value",
	property: "--code-property",
	function: "--code-function",
	type: "--code-type",
	variable: "--code-variable",
	constant: "--code-constant",
	operator: "--code-operator",
	punctuation: "--code-punctuation",
	inserted: "--code-inserted",
	deleted: "--code-deleted",
	changed: "--code-changed",
};

let catalog: ThemeCatalog = { byId: new Map(), list: [] };

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function descriptor(theme: ThemeManifest): ThemeDescriptor {
	return Object.freeze({
		id: theme.id,
		label: theme.label,
		order: theme.order,
		appearance: theme.appearance,
		contrast: theme.contrast,
	});
}

export function buildThemeCatalog(candidates: Record<string, unknown>): ThemeCatalog {
	const byId = new Map<ThemeId, ThemeManifest>();
	for (const [path, candidate] of Object.entries(candidates).sort(([a], [b]) =>
		compareText(a, b),
	)) {
		let theme: ThemeManifest;
		try {
			theme = assertThemeManifest(candidate);
		} catch (error) {
			throw new Error(`Invalid bundled theme ${path}`, { cause: error });
		}
		if (byId.has(theme.id)) throw new Error(`Duplicate bundled theme id: ${theme.id} (${path})`);
		byId.set(theme.id, theme);
	}
	if (!byId.has(DEFAULT_CONFIG.theme)) {
		throw new Error(`The bundled default theme is missing: ${DEFAULT_CONFIG.theme}`);
	}
	const appearances = new Set([...byId.values()].map((theme) => theme.appearance));
	if (!appearances.has("light") || !appearances.has("dark")) {
		throw new Error("The bundled theme catalog must include light and dark themes");
	}
	const list = Object.freeze(
		[...byId.values()]
			.sort((a, b) => {
				if (a.id === DEFAULT_CONFIG.theme) return -1;
				if (b.id === DEFAULT_CONFIG.theme) return 1;
				return a.order - b.order || compareText(a.label, b.label) || compareText(a.id, b.id);
			})
			.map(descriptor),
	);
	return { byId, list };
}

export function installThemeCatalog(next: ThemeCatalog): void {
	catalog = next;
}

export function getThemes(): readonly ThemeDescriptor[] {
	return catalog.list;
}

const RENAMED_THEME_IDS: Readonly<Record<string, ThemeId>> = {
	"high-contrast": "high-contrast-dark",
};

const canonicalThemeId = (id: ThemeId): ThemeId => RENAMED_THEME_IDS[id] ?? id;

function exactTheme(id: ThemeId): ThemeManifest | undefined {
	return catalog.byId.get(canonicalThemeId(id));
}

function requireResolvedTheme(id: ThemeId): ThemeManifest {
	const theme = exactTheme(id) ?? catalog.byId.get(DEFAULT_CONFIG.theme);
	if (!theme) throw new Error(`The bundled default theme is missing: ${DEFAULT_CONFIG.theme}`);
	return theme;
}

function themesByAppearance(appearance: ThemeAppearance): ThemeManifest[] {
	return [...catalog.byId.values()]
		.filter((theme) => theme.appearance === appearance)
		.sort((a, b) => a.order - b.order || compareText(a.label, b.label) || compareText(a.id, b.id));
}

function fallbackTheme(
	appearance: ThemeAppearance,
	preferredContrast?: ThemeContrast,
): ThemeManifest {
	const themes = themesByAppearance(appearance);
	const theme =
		(preferredContrast
			? themes.find((candidate) => candidate.contrast === preferredContrast)
			: undefined) ??
		themes.find((candidate) => candidate.contrast === "normal") ??
		themes[0];
	if (!theme) throw new Error(`The bundled theme catalog has no ${appearance} theme`);
	return theme;
}

function defaultThemePreference(): ThemePreference {
	return { theme: DEFAULT_CONFIG.theme, themeMode: DEFAULT_CONFIG.themeMode };
}

function normalizeThemeHint(value: unknown): ThemePreference {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return defaultThemePreference();
	}
	const theme = Reflect.get(value, "theme");
	const themeMode = Reflect.get(value, "themeMode");
	const rawPair = Reflect.get(value, "systemThemePair");
	if (typeof theme !== "string" || !isThemeIdSlug(theme) || !isThemeMode(themeMode)) {
		return defaultThemePreference();
	}
	const systemThemePair =
		isSystemThemePair(rawPair) && isThemeIdSlug(rawPair.light) && isThemeIdSlug(rawPair.dark)
			? { light: rawPair.light, dark: rawPair.dark }
			: undefined;
	if (themeMode === "system" && !systemThemePair) return defaultThemePreference();
	return normalizeConfigThemePreference({ theme, themeMode, systemThemePair });
}

function colorSchemeMediaQuery(): ColorSchemeMediaQuery | null {
	const matchMedia = Reflect.get(globalThis, "matchMedia");
	if (typeof matchMedia !== "function") return null;
	try {
		const query = Reflect.apply(matchMedia, globalThis, [SYSTEM_QUERY]);
		if (
			typeof query !== "object" ||
			query === null ||
			typeof Reflect.get(query, "matches") !== "boolean"
		) {
			return null;
		}
		return query as ColorSchemeMediaQuery;
	} catch {
		return null;
	}
}

export function readSystemAppearance(): ThemeAppearance {
	return colorSchemeMediaQuery()?.matches ? "dark" : "light";
}

export function onSystemAppearanceChange(
	listener: (appearance: ThemeAppearance) => void,
): () => void {
	const query = colorSchemeMediaQuery();
	if (
		!query ||
		typeof query.addEventListener !== "function" ||
		typeof query.removeEventListener !== "function"
	) {
		return () => undefined;
	}
	const onChange = (event: { matches: boolean }) => listener(event.matches ? "dark" : "light");
	try {
		query.addEventListener("change", onChange);
	} catch {
		return () => undefined;
	}
	return () => query.removeEventListener("change", onChange);
}

export function deriveSystemThemePair(id: ThemeId): SystemThemePair {
	const fixed = requireResolvedTheme(id);
	const pair = {
		light: fallbackTheme("light", fixed.contrast).id,
		dark: fallbackTheme("dark", fixed.contrast).id,
	};
	pair[fixed.appearance] = fixed.id;
	return pair;
}

export function resolveTheme(id: ThemeId): ThemeDescriptor {
	return descriptor(requireResolvedTheme(id));
}

export function resolveThemePreference(
	preference: ThemePreference,
	systemAppearance: ThemeAppearance = readSystemAppearance(),
): ThemeResolution {
	const normalized = normalizeConfigThemePreference(preference);
	if (normalized.themeMode === "fixed" || !normalized.systemThemePair) {
		const exact = exactTheme(normalized.theme);
		return {
			requestedId: normalized.theme,
			theme: descriptor(exact ?? requireResolvedTheme(normalized.theme)),
			fallback: exact === undefined,
			systemAppearance: null,
		};
	}
	const requestedId = normalized.systemThemePair[systemAppearance];
	const exact = exactTheme(requestedId);
	const resolved = exact?.appearance === systemAppearance ? exact : fallbackTheme(systemAppearance);
	return {
		requestedId,
		theme: descriptor(resolved),
		fallback: exact?.appearance !== systemAppearance,
		systemAppearance,
	};
}

function applyVariables(root: HTMLElement, theme: ThemeManifest): void {
	for (const key of THEME_COLOR_KEYS) {
		const variable = paletteVariable(key);
		const color = theme.colors[key];
		if (color === null) root.style.removeProperty(variable);
		else root.style.setProperty(variable, color);
	}
	for (const key of ANSI_COLOR_KEYS) root.style.setProperty(ANSI_VARIABLES[key], theme.ansi[key]);
	for (const key of SYNTAX_COLOR_KEYS)
		root.style.setProperty(SYNTAX_VARIABLES[key], theme.syntax[key]);
	root.dataset.themeAppearance = theme.appearance;
	root.style.setProperty("color-scheme", theme.appearance);
}

function applyResolvedTheme(theme: ThemeManifest): ThemeDescriptor {
	if (typeof document !== "undefined") {
		const root = document.documentElement;
		applyVariables(root, theme);
		root.dataset.themeContrast = theme.contrast;
		root.dataset.theme = theme.id;
	}
	return descriptor(theme);
}

export function applyTheme(id: ThemeId): ThemeDescriptor {
	return applyResolvedTheme(requireResolvedTheme(id));
}

export function applyThemePreference(preference: ThemePreference): ThemeResolution {
	const resolution = resolveThemePreference(preference);
	applyResolvedTheme(requireResolvedTheme(resolution.theme.id));
	return resolution;
}

function themeHintStorage(): StablePreferenceAdapter | null {
	return (
		getStablePreferenceAdapter() ??
		asStablePreferenceAdapter(Reflect.get(globalThis, "localStorage"))
	);
}

export function readThemeHint(): ThemePreference {
	try {
		const value = themeHintStorage()?.getItem(HINT_KEY);
		if (typeof value !== "string") return defaultThemePreference();
		if (isThemeIdSlug(value)) return { theme: value, themeMode: "fixed" };
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Reflect.get(parsed, "version") !== HINT_VERSION
		) {
			return defaultThemePreference();
		}
		return normalizeThemeHint(parsed);
	} catch {
		return defaultThemePreference();
	}
}

export function writeThemeHint(preference: ThemePreference): void {
	try {
		const normalized = normalizeThemeHint(preference);
		themeHintStorage()?.setItem(HINT_KEY, JSON.stringify({ version: HINT_VERSION, ...normalized }));
	} catch {
		return;
	}
}

export function onThemeSwap(onSwap: () => void): () => void {
	const observer = new MutationObserver(onSwap);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}
