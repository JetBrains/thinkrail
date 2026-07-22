import type { ThemeRegistration } from "shiki/core";

/**
 * The classic IntelliJ Darcula palette as a shiki theme — shiki ships no darcula, so we register our own
 * (orange keywords, green strings, gray comments, blue numbers on the `#2b2b2b` editor). Kept per-file
 * (not in the `lib` barrel) like `highlighter.ts`, so it only loads with the lazy shiki chunks.
 */
export const DARCULA_SHIKI: ThemeRegistration = {
	name: "darcula",
	type: "dark",
	settings: [
		{ settings: { foreground: "#a9b7c6", background: "#2b2b2b" } },
		{ scope: ["comment"], settings: { foreground: "#808080" } },
		{ scope: ["comment.block.documentation"], settings: { foreground: "#629755" } },
		{ scope: ["string", "punctuation.definition.string"], settings: { foreground: "#6a8759" } },
		{ scope: ["string.regexp"], settings: { foreground: "#6a8759" } },
		{
			scope: ["keyword", "storage.type", "storage.modifier", "constant.language"],
			settings: { foreground: "#cc7832" },
		},
		{ scope: ["constant.numeric"], settings: { foreground: "#6897bb" } },
		{ scope: ["entity.name.function", "support.function"], settings: { foreground: "#ffc66d" } },
		{ scope: ["entity.name.tag"], settings: { foreground: "#e8bf6a" } },
		{ scope: ["entity.other.attribute-name"], settings: { foreground: "#bababa" } },
		{ scope: ["support.type.property-name.json"], settings: { foreground: "#9876aa" } },
		{ scope: ["markup.inserted"], settings: { foreground: "#6a8759" } },
		{ scope: ["markup.deleted"], settings: { foreground: "#d25252" } },
		{
			scope: ["meta.diff.header", "meta.diff.range", "meta.diff.index"],
			settings: { foreground: "#6897bb" },
		},
	],
};

/**
 * The classical VSCode "Dark High Contrast" (hc-black) palette as a shiki theme — shiki ships only the
 * GitHub HC themes, not VSCode's. Mirrors Monaco's built-in `hc_black` rules (white numbers, #569cd6
 * keywords, #1aebff variables, #ce9178 strings on pure black) so chat/diff code matches the editor;
 * comments use VSCode's current brightened #7ca668 — the same value the theme's `--code-comment` token
 * feeds Monaco (whose bundled base still ships the older #608b4e).
 */
export const HC_BLACK_SHIKI: ThemeRegistration = {
	name: "hc-black",
	type: "dark",
	settings: [
		{ settings: { foreground: "#ffffff", background: "#000000" } },
		{ scope: ["comment", "comment.block.documentation"], settings: { foreground: "#7ca668" } },
		{ scope: ["string", "punctuation.definition.string"], settings: { foreground: "#ce9178" } },
		{ scope: ["string.regexp"], settings: { foreground: "#c0c0c0" } },
		{
			scope: ["keyword", "storage.type", "storage.modifier", "constant.language"],
			settings: { foreground: "#569cd6" },
		},
		{ scope: ["keyword.control"], settings: { foreground: "#c586c0" } },
		{ scope: ["constant.numeric"], settings: { foreground: "#ffffff" } },
		{ scope: ["variable"], settings: { foreground: "#1aebff" } },
		{ scope: ["variable.parameter"], settings: { foreground: "#9cdcfe" } },
		{ scope: ["entity.name.type", "support.type"], settings: { foreground: "#3dc9b0" } },
		{ scope: ["entity.name.tag"], settings: { foreground: "#569cd6" } },
		{ scope: ["entity.other.attribute-name"], settings: { foreground: "#569cd6" } },
		{ scope: ["support.type.property-name.json"], settings: { foreground: "#9cdcfe" } },
		{ scope: ["markup.inserted"], settings: { foreground: "#3ff23f" } },
		{ scope: ["markup.deleted"], settings: { foreground: "#f44747" } },
		{
			scope: ["meta.diff.header", "meta.diff.range", "meta.diff.index"],
			settings: { foreground: "#569cd6" },
		},
	],
};

/**
 * The palette map for `codeToHtml({ themes })`: `dark` is the inline default color; every other entry is
 * emitted as a `--shiki-<name>` CSS var on every token, flipped by the `[data-theme]` rules in
 * `global.css` — a theme swap needs no re-highlighting. `darcula` and `high-contrast` are the custom
 * registrations above; `gruvbox` uses the shiki-shipped `gruvbox-dark-hard` (matching the `#1d2021`
 * content surface).
 */
export const SHIKI_THEMES = {
	dark: "github-dark-default",
	light: "github-light-default",
	darcula: "darcula",
	gruvbox: "gruvbox-dark-hard",
	"high-contrast": "hc-black",
} as const;
