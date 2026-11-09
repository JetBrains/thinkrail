import {
	ANSI_COLOR_KEYS,
	type AnsiColorKey,
	SYNTAX_COLOR_KEYS,
	type SyntaxColorKey,
	THEME_COLOR_KEYS,
	type ThemeManifest,
} from "./schema";

export const paletteVariable = (key: string) =>
	`--${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

export const ANSI_VARIABLES: Record<AnsiColorKey, string> = {
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

export function applyPalette(root: HTMLElement, theme: ThemeManifest): void {
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
