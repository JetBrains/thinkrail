import type { editor } from "monaco-editor";

/**
 * Monaco theme definitions for each Bonsai theme.
 *
 * Editor colors are derived from the CSS variables in styles/theme-dark.css,
 * styles/theme-light.css, and styles/themes.css. Token rules are shared
 * across dark and light variants (with adjusted foreground colors for light).
 */

const DARK_TOKEN_RULES: editor.ITokenThemeRule[] = [
  { token: "keyword", foreground: "CF8E6D" },
  { token: "keyword.control", foreground: "CF8E6D" },
  { token: "string", foreground: "6AAB73" },
  { token: "string.escape", foreground: "CF8E6D" },
  { token: "comment", foreground: "7A7E85", fontStyle: "italic" },
  { token: "number", foreground: "2AACB8" },
  { token: "number.hex", foreground: "2AACB8" },
  { token: "type", foreground: "C77DBB" },
  { token: "type.identifier", foreground: "C77DBB" },
  { token: "identifier", foreground: "DFE1E5" },
  { token: "function", foreground: "56A8F5" },
  { token: "operator", foreground: "DFE1E5" },
  { token: "delimiter", foreground: "DFE1E5" },
  { token: "delimiter.bracket", foreground: "DFE1E5" },
  { token: "tag", foreground: "CF8E6D" },
  { token: "attribute.name", foreground: "C77DBB" },
  { token: "attribute.value", foreground: "6AAB73" },
  { token: "attribute.value.css", foreground: "6AAB73" },
  { token: "selector", foreground: "56A8F5" },
  { token: "string.key.json", foreground: "C77DBB" },
  { token: "string.value.json", foreground: "6AAB73" },
  { token: "keyword.md", foreground: "CF8E6D" },
  { token: "string.link.md", foreground: "56A8F5" },
  { token: "regexp", foreground: "6AAB73" },
  { token: "meta", foreground: "BBB529" },
  { token: "annotation", foreground: "BBB529" },
  { token: "constant", foreground: "CF8E6D" },
];

const LIGHT_TOKEN_RULES: editor.ITokenThemeRule[] = [
  { token: "keyword", foreground: "0033B3" },
  { token: "keyword.control", foreground: "0033B3" },
  { token: "string", foreground: "067D17" },
  { token: "string.escape", foreground: "0033B3" },
  { token: "comment", foreground: "8C8C8C", fontStyle: "italic" },
  { token: "number", foreground: "1750EB" },
  { token: "number.hex", foreground: "1750EB" },
  { token: "type", foreground: "871094" },
  { token: "type.identifier", foreground: "871094" },
  { token: "identifier", foreground: "1e1f22" },
  { token: "function", foreground: "00627A" },
  { token: "operator", foreground: "1e1f22" },
  { token: "delimiter", foreground: "1e1f22" },
  { token: "delimiter.bracket", foreground: "1e1f22" },
  { token: "tag", foreground: "0033B3" },
  { token: "attribute.name", foreground: "871094" },
  { token: "attribute.value", foreground: "067D17" },
  { token: "attribute.value.css", foreground: "067D17" },
  { token: "selector", foreground: "00627A" },
  { token: "string.key.json", foreground: "871094" },
  { token: "string.value.json", foreground: "067D17" },
  { token: "keyword.md", foreground: "0033B3" },
  { token: "string.link.md", foreground: "00627A" },
  { token: "regexp", foreground: "067D17" },
  { token: "meta", foreground: "9E880D" },
  { token: "annotation", foreground: "9E880D" },
  { token: "constant", foreground: "0033B3" },
];

/** Helper to build a dark theme definition from Bonsai CSS variable colors. */
function darkTheme(
  bg: string, panel: string, text: string, border: string,
  sel: string, hint: string, _muted: string,
): editor.IStandaloneThemeData {
  return {
    base: "vs-dark",
    inherit: true,
    rules: DARK_TOKEN_RULES,
    colors: {
      "editor.background": bg,
      "editor.foreground": text,
      "editorCursor.foreground": "#6AC8FF",
      "editor.selectionBackground": sel,
      "editor.inactiveSelectionBackground": sel + "50",
      "editor.lineHighlightBackground": panel,
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": hint,
      "editorLineNumber.activeForeground": text,
      "editorGutter.background": bg,
      "editor.selectionHighlightBackground": sel + "40",
      "editorBracketMatch.background": "#6AC8FF30",
      "editorBracketMatch.border": "#6AC8FF",
      "editorIndentGuide.background": border + "40",
      "editorIndentGuide.activeBackground": border,
      "editorWidget.background": panel,
      "editorWidget.border": border,
      "editorSuggestWidget.background": panel,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.selectedBackground": sel,
      "input.background": panel,
      "input.border": border,
      "input.foreground": text,
      "inputOption.activeBorder": "#6AC8FF",
      "minimap.background": bg,
      "scrollbar.shadow": "#00000050",
      "scrollbarSlider.background": border + "50",
      "scrollbarSlider.hoverBackground": border + "80",
      "scrollbarSlider.activeBackground": border + "A0",
    },
  };
}

/** Helper to build a light theme definition. */
function lightTheme(
  bg: string, panel: string, text: string, border: string,
  sel: string, hint: string, _muted: string,
): editor.IStandaloneThemeData {
  return {
    base: "vs",
    inherit: true,
    rules: LIGHT_TOKEN_RULES,
    colors: {
      "editor.background": bg,
      "editor.foreground": text,
      "editorCursor.foreground": "#6AC8FF",
      "editor.selectionBackground": sel,
      "editor.inactiveSelectionBackground": sel + "80",
      "editor.lineHighlightBackground": panel,
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": hint,
      "editorLineNumber.activeForeground": text,
      "editorGutter.background": bg,
      "editor.selectionHighlightBackground": sel + "60",
      "editorBracketMatch.background": "#6AC8FF20",
      "editorBracketMatch.border": "#6AC8FF",
      "editorIndentGuide.background": border + "40",
      "editorIndentGuide.activeBackground": border,
      "editorWidget.background": panel,
      "editorWidget.border": border,
      "editorSuggestWidget.background": panel,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.selectedBackground": sel,
      "input.background": bg,
      "input.border": border,
      "input.foreground": text,
      "inputOption.activeBorder": "#6AC8FF",
      "minimap.background": bg,
      "scrollbar.shadow": "#00000020",
      "scrollbarSlider.background": border + "40",
      "scrollbarSlider.hoverBackground": border + "60",
      "scrollbarSlider.activeBackground": border + "80",
    },
  };
}

// bg, panel, text, border, sel, hint, muted — from CSS variables
export const MONACO_THEMES: Record<string, editor.IStandaloneThemeData> = {
  "dark":             darkTheme("#1e1f22", "#2b2d30", "#dfe1e5", "#43454a", "#2d4f67", "#6f737a", "#a8adb5"),
  "high-contrast": {
    ...darkTheme("#000000", "#0a0a0a", "#ffffff", "#6fc3df", "#264f78", "#808080", "#d4d4d4"),
    base: "hc-black",
  },
  "dracula":          darkTheme("#282a36", "#21222c", "#f8f8f2", "#44475a", "#44475a", "#6272a4", "#bfbfbf"),
  "nord":             darkTheme("#2e3440", "#3b4252", "#d8dee9", "#4c566a", "#434c5e", "#616e88", "#a5adba"),
  "solarized-dark":   darkTheme("#002b36", "#073642", "#839496", "#2a5e6e", "#073642", "#586e75", "#657b83"),
  "solarized-light":  lightTheme("#fdf6e3", "#eee8d5", "#657b83", "#c9c2ab", "#eee8d5", "#93a1a1", "#839496"),
  "claude-code":      darkTheme("#191a23", "#1f2029", "#e0ddd5", "#353640", "#2d3a50", "#6b6966", "#a8a5a0"),
  "light":            lightTheme("#f7f8fa", "#ffffff", "#1e1f22", "#d1d3d8", "#d4e4fa", "#8c8f96", "#5a5d63"),
};

/** Monaco theme name prefix used for registration. */
export const MONACO_THEME_PREFIX = "bonsai-";
