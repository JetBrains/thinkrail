import { CODE_FONT_SIZE } from "@thinkrail/contracts";
import {
	asStablePreferenceAdapter,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import typography from "../styles/typography.json";

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
 * truth can never leave the slider scaling a stale number.
 */
export const BASE_FONT_SIZES: Readonly<Record<string, number>> = typography.fontSizes;

const LINE_HEIGHT: number = (typography.lineHeights as Readonly<Record<string, number>>)[
	typography.codeRow.lineHeight
] as number;
if (LINE_HEIGHT === undefined) throw new Error("typography.json: codeRow must name a lineHeight");

/** The dense size the stylesheet sets before any scale: `codeRow.fontSize`. */
export const BASE_CODE_FONT_SIZE: number =
	(typography.fontSizes as Readonly<Record<string, number>>)[typography.codeRow.fontSize] ?? 11;

/** The size code is set in: `codeSize.fontSize`, emitted as `--tr-font-size-code`. */
export const BASE_CODE_SIZE: number =
	(typography.fontSizes as Readonly<Record<string, number>>)[typography.codeSize.fontSize] ?? 13;

/** The gap between the code size and the dense size code rows draw with. */
export const CODE_DENSE_INSET: number = CODE_FONT_SIZE.editorDelta;

/** `round(dense × lineHeight)` — the product `renderCss()` emits as `--tr-code-row-height`. */
export const BASE_CODE_ROW_HEIGHT = Math.round(BASE_CODE_FONT_SIZE * LINE_HEIGHT);

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

/** The size code is set in once the reader's own choice and the scale are both applied. */
export function codeSize(codeFontSize: number, scale: number): number {
	return scaledFontSize(codeFontSize, scale);
}

/** The dense size: what code rows, diffs and the review surface draw with. */
export function denseCodeSize(codeFontSize: number, scale: number): number {
	return Math.max(1, codeSize(codeFontSize, scale) - CODE_DENSE_INSET);
}

/**
 * Row height follows the dense size it has to hold — `round(dense × lineHeight)`, the same product
 * the stylesheet emits as 14px. Deriving it from the drawn size keeps text and geometry from
 * drifting apart when either the scale or the reader's own code size changes.
 */
export function codeRowHeight(codeFontSize: number, scale: number): number {
	return Math.round(denseCodeSize(codeFontSize, scale) * LINE_HEIGHT);
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

export function writeFontScale(scale: number): number {
	const applied = clampFontScale(scale);
	try {
		fontScaleStorage()?.setItem(
			HINT_KEY,
			JSON.stringify({ version: HINT_VERSION, scale: applied }),
		);
	} catch {
		// Not persisted, but this window still shows the chosen size.
	}
	return applied;
}
