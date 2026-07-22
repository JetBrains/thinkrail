import { loader, type Monaco } from "@monaco-editor/react";
import type { Environment } from "monaco-editor";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { cssColorToHex } from "@/lib";

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
	set("editor.background", token("--surface-content"));
	set("editor.foreground", token("--code-foreground"));
	set("editorLineNumber.foreground", token("--hint"));
	set("editorCursor.foreground", token("--primary"));
	set("editor.selectionBackground", token("--sel"));
	set("editor.selectionForeground", token("--sel-fg"));
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
	try {
		m.editor.defineTheme(THEME, { base, inherit: true, rules, colors });
	} catch {
		// A token value Monaco can't parse must degrade to the base palette, never crash the panel.
		m.editor.defineTheme(THEME, { base, inherit: true, rules: [], colors: {} });
	}
}

/** Re-theme Monaco on a `[data-theme]` swap: the theme's chrome + contrast-aware base are read once at
 * define time, so without this an editor keeps the theme it mounted with. Disconnect on unmount. */
export function watchThemeSwap(m: Monaco): MutationObserver {
	const observer = new MutationObserver(() => {
		defineThinkrailTheme(m);
		m.editor.setTheme(THEME);
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return observer;
}
