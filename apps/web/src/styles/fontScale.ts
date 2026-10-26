import {
	asStablePreferenceAdapter,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import typography from "./typography.json";

/**
 * The one runtime override of the typography tokens. `styles/typography.json` stays the source of
 * truth: this module never edits a value, it scales the generated custom properties on
 * `documentElement` so a reader who wants larger text can get it without a rebuild. See the
 * "Permitted exceptions" note in `styles/TYPOGRAPHY.md`.
 */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.05;
export const DEFAULT_FONT_SCALE = 1;

const HINT_KEY = `${STORAGE_PREFIX}font-scale`;
const HINT_VERSION = 1;

/**
 * Read from `styles/typography.json` rather than restated here, so raising a size in the source of
 * truth can never leave the slider scaling a stale number. `codeRowHeight` is the same product
 * `renderCss()` emits as `--tr-code-row-height`.
 */
export const BASE_FONT_SIZES: Readonly<Record<string, number>> = typography.fontSizes;

function codeRowHeight(source: typeof typography): number {
	const sizes: Readonly<Record<string, number>> = source.fontSizes;
	const lineHeights: Readonly<Record<string, number>> = source.lineHeights;
	const size = sizes[source.codeRow.fontSize];
	const lineHeight = lineHeights[source.codeRow.lineHeight];
	if (size === undefined || lineHeight === undefined)
		throw new Error("typography.json: codeRow must name a known fontSize and lineHeight");
	return Math.round(size * lineHeight);
}

export const BASE_CODE_ROW_HEIGHT = codeRowHeight(typography);
/** The size code rows are set in (`codeRow.fontSize`), the one Monaco and Pierre draw with. */
export const BASE_CODE_FONT_SIZE: number =
	(typography.fontSizes as Readonly<Record<string, number>>)[typography.codeRow.fontSize] ?? 11;

/**
 * The top bar's fixed rows, scaled with the text they hold. They are sizing roles in
 * `styles/tokens.css`, and `fontScale.test.ts` pins these bases to that file, so the two cannot drift.
 * Without them a 160% caption is cut off by its 14px row and the value pills by their 20px row.
 */
export const BASE_TOPBAR_HEIGHTS: Readonly<Record<string, number>> = {
	"--topbar-row-height": 40,
	"--topbar-caption-height": 14,
	"--topbar-value-height": 20,
};

export function clampFontScale(scale: number): number {
	if (typeof scale !== "number" || Number.isNaN(scale)) return DEFAULT_FONT_SCALE;
	if (scale === Number.POSITIVE_INFINITY) return FONT_SCALE_MAX;
	if (scale === Number.NEGATIVE_INFINITY) return FONT_SCALE_MIN;
	const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
	// Snap to the slider's step so a stored value never lands between two positions.
	const snapped = Math.round(clamped / FONT_SCALE_STEP) * FONT_SCALE_STEP;
	return Number(snapped.toFixed(2));
}

export function fontScalePercent(scale: number): number {
	return Math.round(clampFontScale(scale) * 100);
}

/**
 * Where the thumb sits on the track, 0-100. The range starts at `FONT_SCALE_MIN`, not at zero, so
 * the fill has to be measured from there: at the minimum the track is empty, at the default it is
 * a quarter full, and only the maximum fills it.
 */
export function fontScalePosition(scale: number): number {
	const applied = clampFontScale(scale);
	return Math.round(((applied - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN)) * 100);
}

export function scaledFontSize(base: number, scale: number): number {
	return Math.round(base * clampFontScale(scale));
}

export function scaledCodeFontSize(scale: number): number {
	return scaledFontSize(BASE_CODE_FONT_SIZE, scale);
}

export function scaledCodeRowHeight(scale: number): number {
	return Math.round(BASE_CODE_ROW_HEIGHT * clampFontScale(scale));
}

/**
 * Writes the scaled custom properties onto `root`. At the default scale every property is removed
 * so the generated CSS is used verbatim — the override exists only while the reader wants it.
 */
export function applyFontScale(
	scale: number,
	root: HTMLElement | undefined = typeof document === "undefined"
		? undefined
		: document.documentElement,
): number {
	const applied = clampFontScale(scale);
	if (!root) return applied;
	for (const [id, base] of Object.entries(BASE_FONT_SIZES)) {
		const name = `--tr-font-size-${id}`;
		if (applied === DEFAULT_FONT_SCALE) root.style.removeProperty(name);
		else root.style.setProperty(name, `${scaledFontSize(base, applied)}px`);
	}
	const height = "--tr-code-row-height";
	if (applied === DEFAULT_FONT_SCALE) root.style.removeProperty(height);
	else root.style.setProperty(height, `${scaledCodeRowHeight(applied)}px`);
	for (const [name, base] of Object.entries(BASE_TOPBAR_HEIGHTS)) {
		if (applied === DEFAULT_FONT_SCALE) root.style.removeProperty(name);
		else root.style.setProperty(name, `${Math.round(base * applied)}px`);
	}
	return applied;
}

function fontScaleStorage(): StablePreferenceAdapter | null {
	return (
		getStablePreferenceAdapter() ??
		asStablePreferenceAdapter(Reflect.get(globalThis, "localStorage"))
	);
}

export function readFontScale(): number {
	try {
		const value = fontScaleStorage()?.getItem(HINT_KEY);
		if (typeof value !== "string") return DEFAULT_FONT_SCALE;
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Reflect.get(parsed, "version") !== HINT_VERSION
		) {
			return DEFAULT_FONT_SCALE;
		}
		const scale = Reflect.get(parsed, "scale");
		if (typeof scale !== "number") return DEFAULT_FONT_SCALE;
		return clampFontScale(scale);
	} catch {
		return DEFAULT_FONT_SCALE;
	}
}

const listeners = new Set<() => void>();
let chosen: number | null = null;

/**
 * The scale the reader picked in this window, even when storage refused to keep it. The CSS
 * override follows the slider either way, so anything that sizes rows in JS must follow it too.
 */
export function currentFontScale(): number {
	return chosen ?? readFontScale();
}

export function writeFontScale(scale: number): number {
	const applied = clampFontScale(scale);
	chosen = applied;
	try {
		fontScaleStorage()?.setItem(
			HINT_KEY,
			JSON.stringify({ version: HINT_VERSION, scale: applied }),
		);
	} catch {
		// Not persisted, but this window still shows the chosen size.
	}
	for (const listener of listeners) listener();
	return applied;
}

/**
 * Lets a component that draws code rows follow the reader's choice. It cannot read the custom
 * property itself: Pierre takes its row height as a JS metric and never re-reads it.
 */
export function subscribeFontScale(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
