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

declare global {
	interface Window {
		MonacoEnvironment?: Environment;
	}
}

window.MonacoEnvironment = {
	getWorker(_workerId, label) {
		if (label === "json") return new jsonWorker();
		if (label === "css" || label === "scss" || label === "less") return new cssWorker();
		if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
		if (label === "typescript" || label === "javascript") return new tsWorker();
		return new editorWorker();
	},
};

loader.config({ monaco });

export const THEME = "thinkrail";
export const EDITOR_THEME = "thinkrail-editor";

const languageByPath = new Map<string, string>();

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

function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export function sharedEditorOptions() {
	const fontSize = Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
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

function token(name: string): string {
	return cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

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
		m.editor.defineTheme(THEME, { base, inherit: true, rules: [], colors: {} });
		m.editor.defineTheme(EDITOR_THEME, { base, inherit: true, rules: [], colors: {} });
	}
}

export function watchThemeSwap(m: Monaco, themeName: string = THEME): () => void {
	return onThemeSwap(() => {
		defineThinkrailTheme(m);
		m.editor.setTheme(themeName);
	});
}
