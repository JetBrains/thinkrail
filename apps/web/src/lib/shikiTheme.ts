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
 * The palette map for `codeToHtml({ themes })`: `dark` is the inline default color; every other entry is
 * emitted as a `--shiki-<name>` CSS var on every token, flipped by the `[data-theme]` rules in
 * `global.css` — a theme swap needs no re-highlighting. `darcula` is the custom registration above;
 * `gruvbox` uses the shiki-shipped `gruvbox-dark-hard` (matching the `#1d2021` content surface).
 */
export const SHIKI_THEMES = {
	dark: "github-dark-default",
	light: "github-light-default",
	darcula: "darcula",
	gruvbox: "gruvbox-dark-hard",
} as const;
