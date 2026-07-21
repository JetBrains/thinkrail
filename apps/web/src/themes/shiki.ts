import type { ThemeRegistration } from "shiki/core";

export const THINKRAIL_SHIKI_THEME_NAME = "thinkrail-css-variables";

/**
 * One web-only TextMate scope map for every ThinkRail theme. Shiki supports arbitrary color values,
 * including CSS variables, so highlighted markup follows theme swaps without re-highlighting.
 */
export const THINKRAIL_SHIKI_THEME: ThemeRegistration = {
	name: THINKRAIL_SHIKI_THEME_NAME,
	type: "dark",
	settings: [
		{
			settings: {
				foreground: "var(--code-foreground)",
				background: "var(--surface-content)",
			},
		},
		{ scope: ["comment"], settings: { foreground: "var(--code-comment)" } },
		{
			scope: ["comment.block.documentation", "comment.line.documentation"],
			settings: { foreground: "var(--code-comment-doc)" },
		},
		{
			scope: ["keyword", "storage.type", "storage.modifier", "constant.language"],
			settings: { foreground: "var(--code-keyword)" },
		},
		{
			scope: ["string", "punctuation.definition.string"],
			settings: { foreground: "var(--code-string)" },
		},
		{ scope: ["string.regexp"], settings: { foreground: "var(--code-regexp)" } },
		{ scope: ["constant.numeric"], settings: { foreground: "var(--code-number)" } },
		{
			scope: ["meta.decorator", "meta.annotation", "punctuation.decorator"],
			settings: { foreground: "var(--code-annotation)" },
		},
		{ scope: ["entity.name.tag"], settings: { foreground: "var(--code-tag)" } },
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: "var(--code-attribute-name)" },
		},
		{
			scope: ["string.unquoted.attribute-value", "meta.attribute-with-value string"],
			settings: { foreground: "var(--code-attribute-value)" },
		},
		{
			scope: ["support.type.property-name", "meta.object-literal.key", "meta.mapping.key"],
			settings: { foreground: "var(--code-property)" },
		},
		{
			scope: ["entity.name.function", "support.function", "variable.function"],
			settings: { foreground: "var(--code-function)" },
		},
		{
			scope: ["entity.name.type", "entity.name.class", "entity.name.interface", "support.type"],
			settings: { foreground: "var(--code-type)" },
		},
		{
			scope: ["variable", "meta.definition.variable.name"],
			settings: { foreground: "var(--code-variable)" },
		},
		{
			scope: ["constant", "variable.other.constant"],
			settings: { foreground: "var(--code-constant)" },
		},
		{
			scope: ["keyword.operator"],
			settings: { foreground: "var(--code-operator)" },
		},
		{
			scope: ["punctuation", "meta.brace", "meta.delimiter"],
			settings: { foreground: "var(--code-punctuation)" },
		},
		{ scope: ["markup.inserted"], settings: { foreground: "var(--code-inserted)" } },
		{ scope: ["markup.deleted"], settings: { foreground: "var(--code-deleted)" } },
		{
			scope: ["markup.changed", "meta.diff.header", "meta.diff.range", "meta.diff.index"],
			settings: { foreground: "var(--code-changed)" },
		},
	],
};
