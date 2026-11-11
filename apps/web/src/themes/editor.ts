import { PIERRE_BASE_SYNTAX } from "./pierre";

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

interface ResolveThinkrailEditorThemeOptions {
	readVariable: (name: string) => string;
	toHex: (color: string) => string;
}

export function resolveThinkrailEditorTheme({
	readVariable,
	toHex,
}: ResolveThinkrailEditorThemeOptions) {
	const rule = (token: string, name = "foreground") => {
		const foreground = toHex(readVariable(`--code-${name}`)).replace(/^#/, "");
		return foreground ? [{ token, foreground }] : [];
	};
	const rules = [
		...rule(""),
		...Object.entries(PIERRE_BASE_SYNTAX).flatMap(([token, style]) => rule(token, style.color)),
		...rule("emphasis").map((emphasis) => ({ ...emphasis, fontStyle: "" })),
	];
	const colors = Object.fromEntries(
		Object.entries(THINKRAIL_MONACO_COLOR_VARIABLES).flatMap(([key, variable]) => {
			const color = toHex(readVariable(variable));
			return color ? [[key, color]] : [];
		}),
	);
	return { rules, colors };
}
