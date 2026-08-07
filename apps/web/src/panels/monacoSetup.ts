import { loader, type Monaco } from "@monaco-editor/react";
import type { Environment } from "monaco-editor";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { cssColorToHex } from "@/lib";
import { onThemeSwap } from "../themes";

// The Monaco setup shared by the file viewer (`MonacoEditor`) and the diff tab (`MonacoDiff`):
// worker wiring, the local (non-CDN) loader, and the token-driven `thinkrail` theme. Import-time
// side effects run once — both lazy chunks resolve to this one module.

declare global {
	interface Window {
		MonacoEnvironment?: Environment;
	}
}

// Monaco's web workers, wired through Vite. Without this Monaco drops to the main thread and breaks
// language features — the #1 Monaco-under-Vite gotcha.
window.MonacoEnvironment = {
	getWorker(_workerId, label) {
		if (label === "json") return new jsonWorker();
		if (label === "css" || label === "scss" || label === "less") return new cssWorker();
		if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
		if (label === "typescript" || label === "javascript") return new tsWorker();
		return new editorWorker();
	},
};

// Use the locally-bundled Monaco instead of the loader's CDN default — keeps the app self-contained.
loader.config({ monaco });

export const THEME = "thinkrail";
/** The document-editor canvas theme: identical to THEME but painted on `container-workspace-bg` (the
 * file editor + markdown Source view). THEME stays on `container-content-bg` for the Changes diff. */
export const EDITOR_THEME = "thinkrail-editor";

// Resolved language ids, cached per path. The probe model below is disposed immediately, and the answer
// is pure per path, so a given file is probed at most once.
const languageByPath = new Map<string, string>();

/**
 * Resolve a Monaco language id from a file path using Monaco's *own* built-in resolver — the same
 * inference the file `Editor` gets implicitly when it creates a model without a language.
 * `@monaco-editor/react`'s `DiffEditor` instead defaults to `"text"` when no `language` is passed, so the
 * diff renders unhighlighted unless we resolve the language ourselves. Rather than reimplement Monaco's
 * matching (extensions + filenames + glob + first-line), we probe with a throwaway model on a private
 * `lang-probe://` scheme (so it can never collide with a real model), read what Monaco guessed, and
 * dispose it — so the diff and the file viewer resolve language through exactly one path. Memoized.
 */
export function languageForPath(path: string): string {
	const cached = languageByPath.get(path);
	if (cached !== undefined) return cached;
	const uri = monaco.Uri.parse(`lang-probe://probe/${path}`);
	const existing = monaco.editor.getModel(uri);
	const model = existing ?? monaco.editor.createModel("", undefined, uri);
	const id = model.getLanguageId();
	if (!existing) model.dispose();
	languageByPath.set(path, id);
	return id;
}

/** Raw CSS custom property off the document root (no hex canonicalization — for font tokens, not colors). */
function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/**
 * The text/style options shared by the file viewer (`MonacoEditor`) and the diff tab (`MonacoDiff`), so
 * plain code and a diff of that code render identically. Font size/family/line-height are read straight
 * off the generated typography tokens (`--tr-font-size-s11`, `--tr-font-family-code`,
 * `--tr-line-height-default` — the values behind `tr-code-text`), never Monaco's built-in monospace
 * defaults, so the editor cannot drift from a code block. Read at render time (like the theme) so DOM
 * tokens are resolved.
 */
export function sharedEditorOptions() {
	const fontSize = Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
	// `--line-height` is a unitless multiplier (e.g. 1.6); Monaco reads 0<v<8 as a multiplier of fontSize.
	const lineHeight = Number.parseFloat(cssVar("--tr-line-height-default") ?? "") || undefined;
	return {
		readOnly: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		automaticLayout: true,
		fontSize,
		fontFamily: cssVar("--tr-font-family-code") ?? "monospace",
		...(lineHeight && lineHeight > 0 ? { lineHeight } : {}),
	} as const;
}

/** Read a CSS custom property off the document root, so Monaco's chrome tracks the active theme tokens.
 * Canonicalized to hex: the built CSS is minified (`#ffffff` → `#fff`, `#808080` → `gray`), and Monaco
 * accepts only hex — an unparseable value reads as unset (`""`) and is dropped by the callers. */
function token(name: string): string {
	return cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Monaco token names → the complete semantic syntax palette every manifest supplies. */
const SYNTAX_TOKENS: readonly [string, string][] = [
	["keyword", "--code-keyword"],
	["string", "--code-string"],
	["comment", "--code-comment"],
	["comment.doc", "--code-comment-doc"],
	["number", "--code-number"],
	["regexp", "--code-regexp"],
	["annotation", "--code-annotation"],
	["tag", "--code-tag"],
	["metatag", "--code-tag"],
	["attribute.name", "--code-attribute-name"],
	["attribute.value", "--code-attribute-value"],
	["string.key.json", "--code-property"],
	["property", "--code-property"],
	["function", "--code-function"],
	["type.identifier", "--code-type"],
	["identifier", "--code-variable"],
	["constant", "--code-constant"],
	["operator", "--code-operator"],
	["delimiter", "--code-punctuation"],
];

/** Define (or redefine) Monaco from the live theme variables: chrome + the complete semantic syntax
 * palette, with its normal/high-contrast base selected from manifest metadata rather than a known theme id.
 * Called before mount and again after every atomic theme swap. */
export function defineThinkrailTheme(m: Monaco): void {
	const colors: Record<string, string> = {};
	const set = (key: string, value: string) => {
		if (value) colors[key] = value;
	};
	set("editor.foreground", token("--code-foreground"));
	set("editorLineNumber.foreground", token("--text-muted"));
	set("editorCursor.foreground", token("--primary"));
	set("editor.selectionBackground", token("--editor-selection-bg"));
	set("editor.selectionForeground", token("--editor-selection-text"));
	const rules = SYNTAX_TOKENS.flatMap(([monacoToken, name]) => {
		const color = token(name);
		return color ? [{ token: monacoToken, foreground: color.replace("#", "") }] : [];
	});
	const root = document.documentElement;
	const colorScheme = getComputedStyle(root).colorScheme;
	const light = colorScheme.split(/\s+/).includes("light");
	const base =
		root.dataset.themeContrast === "high"
			? light
				? "hc-light"
				: "hc-black"
			: light
				? "vs"
				: "vs-dark";
	// Two themes, identical but for the canvas background: THEME is the diff surface (content-bg), and
	// EDITOR_THEME is the document editor canvas (workspace-bg). Only one Monaco instance mounts at a time
	// (the active center tab), so switching the global theme per instance is safe.
	const withBackground = (bg: string): Record<string, string> =>
		bg ? { ...colors, "editor.background": bg } : colors;
	const contentBg = token("--container-content-bg");
	const workspaceBg = token("--container-workspace-bg");
	try {
		m.editor.defineTheme(THEME, { base, inherit: true, rules, colors: withBackground(contentBg) });
		m.editor.defineTheme(EDITOR_THEME, {
			base,
			inherit: true,
			rules,
			colors: withBackground(workspaceBg),
		});
	} catch {
		// A token value Monaco can't parse must degrade to the base palette, never crash the panel.
		m.editor.defineTheme(THEME, { base, inherit: true, rules: [], colors: {} });
		m.editor.defineTheme(EDITOR_THEME, { base, inherit: true, rules: [], colors: {} });
	}
}

/** Re-theme Monaco on a `[data-theme]` swap: the theme's chrome + contrast-aware base are read once at
 * define time, so without this an editor keeps the theme it mounted with. Call the returned
 * unsubscribe on unmount. */
export function watchThemeSwap(m: Monaco, themeName: string = THEME): () => void {
	return onThemeSwap(() => {
		defineThinkrailTheme(m);
		m.editor.setTheme(themeName);
	});
}
