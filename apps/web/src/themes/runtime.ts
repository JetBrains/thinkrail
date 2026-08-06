import { DEFAULT_CONFIG, type ThemeId } from "@thinkrail/contracts";
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

const HINT_KEY = `${STORAGE_PREFIX}theme`;

/**
 * The CSS custom property a manifest key writes to. DERIVED, not tabulated: `borderStrong` writes
 * `--border-strong`, `editorSelection` writes `--editor-selection`. The lookup table this replaces was
 * a second list to keep in step, and its names (`--blue` for `info`, `--border2` for `borderStrong`)
 * had stopped describing what they held. `styles/colors.json` derives the same way, so a role's
 * `from` and the variable it reads can never disagree.
 */
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

/** Validate and index manifest candidates (path → parsed JSON). The files are ours: any bad one throws. */
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

/** The bundled catalog, sorted default-first — fixed after bootstrap. */
export function getThemes(): readonly ThemeDescriptor[] {
	return catalog.list;
}

function requireResolvedTheme(id: ThemeId): ThemeManifest {
	const theme = catalog.byId.get(id) ?? catalog.byId.get(DEFAULT_CONFIG.theme);
	if (!theme) throw new Error(`The bundled default theme is missing: ${DEFAULT_CONFIG.theme}`);
	return theme;
}

/** Resolve an available theme or the bundled default. */
export function resolveTheme(id: ThemeId): ThemeDescriptor {
	return descriptor(requireResolvedTheme(id));
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
	// The appearance-level effects (scrims, shadows) are CSS, keyed off this attribute — they are
	// constants per light/dark, not palette derivations, so they need no JavaScript table.
	root.dataset.themeAppearance = theme.appearance;
	root.style.setProperty("color-scheme", theme.appearance);
}

/**
 * Apply the requested theme atomically from consumers' perspective: all variables, color-scheme, and
 * contrast metadata are written first, then data-theme changes last so observers see a complete palette.
 */
export function applyTheme(id: ThemeId): ThemeDescriptor {
	const theme = requireResolvedTheme(id);
	if (typeof document !== "undefined") {
		const root = document.documentElement;
		applyVariables(root, theme);
		root.dataset.themeContrast = theme.contrast;
		root.dataset.theme = theme.id;
	}
	return descriptor(theme);
}

/** Cached requested id for first paint; it is a hint only, never the source of truth. */
export function readThemeHint(): ThemeId {
	try {
		const value = localStorage.getItem(HINT_KEY);
		return typeof value === "string" && isThemeIdSlug(value) ? value : DEFAULT_CONFIG.theme;
	} catch {
		return DEFAULT_CONFIG.theme;
	}
}

/** Best-effort first-paint cache. Unknown-but-valid ids are retained for a later app version. */
export function writeThemeHint(id: ThemeId): void {
	try {
		localStorage.setItem(HINT_KEY, id);
	} catch {
		return;
	}
}

/**
 * Run `onSwap` after a theme change has fully landed; returns an unsubscribe.
 *
 * `applyTheme` writes `data-theme` **last**, once every palette variable is in place, so that attribute is the
 * atomic "the new theme is complete" signal. Consumers that cannot wear a CSS class — Monaco, xterm, mermaid —
 * re-read the resolved custom properties at this point. It belongs here because this module owns that contract;
 * three hand-copied MutationObservers used to re-encode it independently, which is the duplication `AGENTS.md`
 * forbids.
 */
export function onThemeSwap(onSwap: () => void): () => void {
	const observer = new MutationObserver(onSwap);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}
