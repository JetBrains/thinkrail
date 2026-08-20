import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	ANSI_COLOR_KEYS,
	parseThemeManifest,
	SYNTAX_COLOR_KEYS,
	THEME_COLOR_KEYS,
	type ThemeManifest,
} from "./schema";

function bundledCandidates(): { file: string; value: unknown }[] {
	const dir = join(import.meta.dir, "bundled");
	return readdirSync(dir)
		.filter((file) => file.endsWith(".theme.json"))
		.sort()
		.map((file) => ({ file, value: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

function bundledThemes(): ThemeManifest[] {
	return bundledCandidates().map(({ file, value }) => {
		const parsed = parseThemeManifest(value);
		if (!parsed.ok) throw new Error(`${file}: ${parsed.issues.join("; ")}`);
		return parsed.value;
	});
}

function luminance(hex: string): number {
	const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
	const [red = 0, green = 0, blue = 0] = channels.map((value) =>
		value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string): number {
	const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (lighter + 0.05) / (darker + 0.05);
}

test("every bundled theme is complete, unique, and includes the configured default", () => {
	const themes = bundledThemes();
	const ids = themes.map((theme) => theme.id);
	expect(themes.length).toBeGreaterThan(0);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids).toContain(DEFAULT_CONFIG.theme);
});

test("runtime palette keys stay aligned with the authoring JSON schema", () => {
	const schema = JSON.parse(readFileSync(join(import.meta.dir, "theme.schema.json"), "utf8")) as {
		$defs: Record<string, { required: string[] }>;
	};
	expect(schema.$defs.colors?.required).toEqual([...THEME_COLOR_KEYS]);
	expect(schema.$defs.ansi?.required).toEqual([...ANSI_COLOR_KEYS]);
	expect(schema.$defs.syntax?.required).toEqual([...SYNTAX_COLOR_KEYS]);
});

test("the parser rejects partial, unknown, and non-canonical manifest data all-or-nothing", () => {
	const source = bundledCandidates()[0]?.value;
	expect(source).toBeDefined();

	const partial = structuredClone(source) as Record<string, unknown>;
	delete (partial.syntax as Record<string, unknown>).keyword;
	expect(parseThemeManifest(partial).ok).toBe(false);

	const unknown = structuredClone(source) as Record<string, unknown>;
	unknown.injectedCss = "body { display: none }";
	expect(parseThemeManifest(unknown).ok).toBe(false);

	const nonCanonical = structuredClone(source) as { colors: Record<string, unknown> };
	nonCanonical.colors.accent = "rgb(0, 0, 0)";
	expect(parseThemeManifest(nonCanonical).ok).toBe(false);
});

test("high-contrast manifests provide legible selected-text foregrounds", () => {
	const themes = bundledThemes().filter((theme) => theme.contrast === "high");
	expect(themes.length).toBeGreaterThan(0);
	for (const theme of themes) {
		const browserForeground = theme.colors.selectionForeground;
		const editorForeground = theme.colors.editorSelectionForeground;
		expect(browserForeground, `${theme.id}: browser selected-text foreground`).not.toBeNull();
		expect(editorForeground, `${theme.id}: editor selected-text foreground`).not.toBeNull();
		if (browserForeground) {
			expect(contrast(browserForeground, theme.colors.selection)).toBeGreaterThanOrEqual(4.5);
		}
		if (editorForeground) {
			expect(contrast(editorForeground, theme.colors.editorSelection)).toBeGreaterThanOrEqual(4.5);
		}
	}
});

/**
 * Contrast is the property that makes a palette trustworthy rather than merely tidy, so the floors are
 * enumerated here rather than left to review.
 *
 * RESTING surfaces get the full WCAG AA floor. `elevated` and `input` matter as much as `background`:
 * every dialog, popover and card sits on the first, and every field on the second.
 *
 * HOVER is deliberately held to a lower bar. These themes lift the row background toward the text
 * colour on hover, which eats contrast exactly where rows are interactive. Requiring the full 4.5 there
 * would force a theme's signature accent toward a washed-out tint just to survive the hovered row.
 * WCAG has no "transient state" allowance, so this tier is OUR
 * judgement, written down: hovered text must still be comfortably visible (3.0), never merely present.
 *
 * `accent` and `success` are excluded from `input` on purpose: no component renders accent- or
 * success-coloured text on a control background (`colorUsage.test.ts` keeps that honest by banning
 * palette entries at call sites).
 */
const RESTING = ["background", "content", "sidebar", "header", "elevated", "input"] as const;
/** Body/muted text meet 4.5; the deliberately quiet hint tier remains visible at 3.0. */
const FLOORS = { text: 4.5, muted: 4.5, hint: 3, accent: 4.5, success: 4.5 } as const;
/** Foregrounds that are never rendered on a control background. */
const NOT_ON_INPUT: ReadonlySet<string> = new Set(["accent", "success"]);
const HOVER_FLOOR = 3;

/**
 * A `contrast: "high"` theme is held to a HIGHER bar than the rest, because "high contrast" is the
 * whole reason it exists — a flat AA floor lets one silently decay into an ordinary theme while every
 * gate stays green, which is exactly what happened when the palette went green (High Contrast Light's
 * accent fell 8.98 → 5.17 and its success 7.39 → 5.08, both still "passing" 4.5). So: AAA (7.0) resting
 * and the full AA (4.5) even on hover. `hint` is exempt — it is a deliberately quiet tier, and raising
 * it would just merge it into `muted`.
 */
const HIGH_CONTRAST_RESTING = 7;
const HIGH_CONTRAST_HOVER = 4.5;
const isHigh = (theme: { contrast: string }) => theme.contrast === "high";
const restingFloor = (theme: { contrast: string }, key: string, floor: number) =>
	isHigh(theme) && key !== "hint" ? Math.max(floor, HIGH_CONTRAST_RESTING) : floor;

test("every bundled manifest meets the contrast floors on every resting surface", () => {
	for (const theme of bundledThemes()) {
		for (const [key, floor] of Object.entries(FLOORS)) {
			const foreground = theme.colors[key as keyof typeof FLOORS];
			for (const surface of RESTING) {
				if (NOT_ON_INPUT.has(key) && surface === "input") continue;
				expect(
					contrast(foreground, theme.colors[surface]),
					`${theme.id}: ${key} on ${surface}`,
				).toBeGreaterThanOrEqual(restingFloor(theme, key, floor));
			}
		}
	}
});

/**
 * The primary button is a palette pair, not a constant: `accentSolid` is its resting fill,
 * `accentHover` its hover fill, and `onAccent` the label that sits on BOTH. A theme that darkens
 * (or brightens) its hover step far enough to swallow the label is the failure this catches — the
 * hover state is a resting foreground for as long as the pointer is there, so it takes the full
 * 4.5, not the transient-hover allowance above.
 */
test("the primary control's label stays legible on both its resting and hover fill", () => {
	for (const theme of bundledThemes()) {
		for (const fill of ["accentSolid", "accentHover"] as const) {
			expect(
				contrast(theme.colors.onAccent, theme.colors[fill]),
				`${theme.id}: onAccent on ${fill}`,
			).toBeGreaterThanOrEqual(4.5);
		}
	}
});

test("hovered text never drops below the visibility floor", () => {
	for (const theme of bundledThemes()) {
		for (const key of Object.keys(FLOORS)) {
			const floor = isHigh(theme) && key !== "hint" ? HIGH_CONTRAST_HOVER : HOVER_FLOOR;
			expect(
				contrast(theme.colors[key as keyof typeof FLOORS], theme.colors.hover),
				`${theme.id}: ${key} on hover`,
			).toBeGreaterThanOrEqual(floor);
		}
	}
});
