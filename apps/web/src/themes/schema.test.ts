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

test("every bundled manifest meets the primary text contrast floors", () => {
	const surfaces = ["background", "content", "sidebar"] as const;
	for (const theme of bundledThemes()) {
		for (const surface of surfaces) {
			expect(
				contrast(theme.colors.text, theme.colors[surface]),
				`${theme.id}: text on ${surface}`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(theme.colors.muted, theme.colors[surface]),
				`${theme.id}: muted on ${surface}`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(theme.colors.hint, theme.colors[surface]),
				`${theme.id}: hint on ${surface}`,
			).toBeGreaterThanOrEqual(3);
		}
	}
});
