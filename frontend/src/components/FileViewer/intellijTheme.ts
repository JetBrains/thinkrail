import type { editor } from "monaco-editor";

/**
 * IntelliJ Darcula / New UI dark theme for Monaco Editor.
 * Colors match our JetBrains-inspired CSS variables.
 */
export const intellijDarcula: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // Keywords & control flow (orange)
    { token: "keyword", foreground: "CF8E6D" },
    { token: "keyword.control", foreground: "CF8E6D" },

    // Strings (green)
    { token: "string", foreground: "6AAB73" },
    { token: "string.escape", foreground: "CF8E6D" },

    // Comments (gray, italic)
    { token: "comment", foreground: "7A7E85", fontStyle: "italic" },

    // Numbers (teal)
    { token: "number", foreground: "2AACB8" },
    { token: "number.hex", foreground: "2AACB8" },

    // Types & classes (purple)
    { token: "type", foreground: "C77DBB" },
    { token: "type.identifier", foreground: "C77DBB" },

    // Functions (blue)
    { token: "identifier", foreground: "DFE1E5" },
    { token: "function", foreground: "56A8F5" },

    // Operators & delimiters
    { token: "operator", foreground: "DFE1E5" },
    { token: "delimiter", foreground: "DFE1E5" },
    { token: "delimiter.bracket", foreground: "DFE1E5" },

    // HTML/XML
    { token: "tag", foreground: "CF8E6D" },
    { token: "attribute.name", foreground: "C77DBB" },
    { token: "attribute.value", foreground: "6AAB73" },

    // CSS
    { token: "attribute.value.css", foreground: "6AAB73" },
    { token: "selector", foreground: "56A8F5" },

    // JSON
    { token: "string.key.json", foreground: "C77DBB" },
    { token: "string.value.json", foreground: "6AAB73" },

    // Markdown
    { token: "keyword.md", foreground: "CF8E6D" },
    { token: "string.link.md", foreground: "56A8F5" },

    // Regex
    { token: "regexp", foreground: "6AAB73" },

    // Preprocessor / meta
    { token: "meta", foreground: "BBB529" },
    { token: "annotation", foreground: "BBB529" },

    // Constants / booleans
    { token: "constant", foreground: "CF8E6D" },
  ],
  colors: {
    "editor.background": "#1e1f22",
    "editor.foreground": "#dfe1e5",
    "editorCursor.foreground": "#3B74EE",
    "editor.selectionBackground": "#2d4f67",
    "editor.inactiveSelectionBackground": "#2d4f6750",
    "editor.lineHighlightBackground": "#2b2d30",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.foreground": "#6f737a",
    "editorLineNumber.activeForeground": "#dfe1e5",
    "editorGutter.background": "#1e1f22",
    "editor.selectionHighlightBackground": "#2d4f6740",
    "editorBracketMatch.background": "#3B74EE30",
    "editorBracketMatch.border": "#3B74EE",
    "editorIndentGuide.background": "#43454a40",
    "editorIndentGuide.activeBackground": "#43454a",
    "editorWidget.background": "#2b2d30",
    "editorWidget.border": "#43454a",
    "editorSuggestWidget.background": "#2b2d30",
    "editorSuggestWidget.border": "#43454a",
    "editorSuggestWidget.selectedBackground": "#2d4f67",
    "input.background": "#393b40",
    "input.border": "#43454a",
    "input.foreground": "#dfe1e5",
    "inputOption.activeBorder": "#3B74EE",
    "minimap.background": "#1e1f22",
    "minimapGutter.addedBackground": "#21D789",
    "minimapGutter.modifiedBackground": "#3B74EE",
    "minimapGutter.deletedBackground": "#F75464",
    "scrollbar.shadow": "#00000050",
    "scrollbarSlider.background": "#43454a50",
    "scrollbarSlider.hoverBackground": "#43454a80",
    "scrollbarSlider.activeBackground": "#43454aA0",
  },
};
