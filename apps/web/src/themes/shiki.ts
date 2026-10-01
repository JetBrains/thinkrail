import type { ThemeRegistration } from "shiki/core";

export const THINKRAIL_SHIKI_THEME_NAME = "thinkrail-css-variables";

export const THINKRAIL_SHIKI_THEME: ThemeRegistration = {
	name: THINKRAIL_SHIKI_THEME_NAME,
	type: "dark",
	settings: [
		{
			settings: {
				foreground: "var(--code-foreground)",
				background: "var(--container-content-bg)",
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

export const THINKRAIL_MONACO_COLOR_VARIABLES = {
	"editor.background": "--container-workspace-bg",
	"editor.foreground": "--code-foreground",
	"editor.lineHighlightBackground": "--control-bg-hovered",
	"editor.lineHighlightBorder": "--border-muted",
	"editorCursor.foreground": "--primary",
	"editorLineNumber.foreground": "--text-muted",
	"editorLineNumber.activeForeground": "--text-default",
	"editorIndentGuide.background1": "--border-muted",
	"editorIndentGuide.activeBackground1": "--border-default",
	"editorBracketMatch.background": "--primary-soft",
	"editorBracketMatch.border": "--primary",
	"editor.wordHighlightBackground": "--primary-soft",
	"editor.selectionBackground": "--editor-selection-bg",
	"editor.selectionForeground": "--editor-selection-text",
	"editor.selectionHighlightBackground": "--editor-selection-highlight-bg",
	"editor.findMatchBackground": "--editor-find-match-bg",
	"editor.findMatchHighlightBackground": "--feedback-warning-subtle",
	"editorStickyScroll.background": "--container-workspace-bg",
	"editorStickyScroll.shadow": "--widget-shadow",
	"editorGutter.background": "--container-workspace-bg",
	"editor.foldBackground": "--primary-subtle",
	"editorWhitespace.foreground": "--text-subtle",
	"editorBracketHighlight.foreground1": "--ansi-yellow",
	"editorBracketHighlight.foreground2": "--ansi-magenta",
	"editorBracketHighlight.foreground3": "--ansi-cyan",
	"editorBracketHighlight.foreground4": "--ansi-blue",
	"editorBracketHighlight.foreground5": "--ansi-green",
	"editorBracketHighlight.foreground6": "--ansi-red",
	"editorWidget.background": "--container-elevated-bg",
	"editorWidget.border": "--border-default",
	"editorWidget.foreground": "--text-default",
	"editorHoverWidget.background": "--container-elevated-bg",
	"editorHoverWidget.border": "--border-default",
	"editorHoverWidget.foreground": "--text-default",
	"menu.background": "--container-elevated-bg",
	"menu.foreground": "--text-default",
	"menu.selectionBackground": "--control-bg-selected",
	"menu.selectionForeground": "--text-default",
	"menu.separatorBackground": "--border-muted",
	"menu.border": "--border-default",
	"quickInput.background": "--container-elevated-bg",
	"quickInput.foreground": "--text-default",
	"quickInputList.focusBackground": "--control-bg-selected",
	"input.background": "--control-bg",
	"input.foreground": "--text-default",
	"input.border": "--control-border-default",
	focusBorder: "--primary",
	"widget.shadow": "--widget-shadow",
	"scrollbar.shadow": "--widget-shadow",
	"scrollbarSlider.background": "--border-default",
	"scrollbarSlider.hoverBackground": "--text-muted",
	"scrollbarSlider.activeBackground": "--text-muted",
} as const;

interface ResolveThinkrailShikiThemeOptions {
	name: string;
	type: "light" | "dark";
	readVariable: (name: string) => string;
	toHex: (color: string) => string;
}

const CSS_VARIABLE = /^var\((--[a-z0-9-]+)\)$/i;

export function resolveThinkrailShikiTheme({
	name,
	type,
	readVariable,
	toHex,
}: ResolveThinkrailShikiThemeOptions): ThemeRegistration {
	const resolveColor = (color: string): string => {
		const variable = CSS_VARIABLE.exec(color)?.[1];
		return toHex(variable ? readVariable(variable) : color);
	};
	const settings = (THINKRAIL_SHIKI_THEME.settings ?? []).map((entry) => {
		const next = { ...entry.settings };
		if (entry.settings?.foreground) {
			const foreground = resolveColor(entry.settings.foreground);
			if (foreground) next.foreground = foreground;
			else delete next.foreground;
		}
		if (entry.settings?.background) {
			const background = resolveColor(entry.settings.background);
			if (background) next.background = background;
			else delete next.background;
		}
		return { ...entry, settings: next };
	});
	const colors = Object.fromEntries(
		Object.entries(THINKRAIL_MONACO_COLOR_VARIABLES).flatMap(([key, variable]) => {
			const color = toHex(readVariable(variable));
			return color ? [[key, color]] : [];
		}),
	);
	return { ...THINKRAIL_SHIKI_THEME, name, type, settings, colors };
}
