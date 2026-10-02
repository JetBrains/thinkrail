import { loader } from "@monaco-editor/react";
import { shikiToMonaco, textmateThemeToMonacoTheme } from "@shikijs/monaco";
import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import "monaco-editor/esm/vs/editor/browser/coreCommands.js";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/links/browser/links.js";
import "monaco-editor/esm/vs/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-editor/esm/vs/editor/contrib/stickyScroll/browser/stickyScrollContribution.js";
import "monaco-editor/esm/vs/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import { onThemeSwap } from "@thinkrail/ui/theme";
import type { Environment, editor } from "monaco-editor/esm/vs/editor/editor.api.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { cssColorToHex } from "@/lib";
import { SHIKI_FILE_LANGUAGES } from "@/lib/highlighter";
import { resolveThinkrailShikiTheme } from "../themes";
import { editorWrappingOptions } from "./editorWrapping";

declare global {
	interface Window {
		MonacoEnvironment?: Environment;
	}
}

window.MonacoEnvironment = {
	getWorker() {
		return new editorWorker();
	},
};

loader.config({ monaco });

export const EDITOR_THEME = "thinkrail-editor";

const BRACKETS: [string, string][] = [
	["(", ")"],
	["[", "]"],
	["{", "}"],
];

function registerShikiLanguages(): void {
	const registered = new Set(monaco.languages.getLanguages().map((language) => language.id));
	for (const language of SHIKI_FILE_LANGUAGES) {
		if (!registered.has(language.id)) {
			monaco.languages.register({
				id: language.id,
				extensions: [...language.extensions],
				aliases: [...language.aliases],
				...(language.filenames ? { filenames: [...language.filenames] } : {}),
			});
			registered.add(language.id);
		}
		monaco.languages.setLanguageConfiguration(language.id, {
			brackets: BRACKETS,
			colorizedBracketPairs: BRACKETS,
		});
	}
}

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

export function fileEditorOptions(lineWidth: number, bounded: boolean, path: string) {
	const fontSize = Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
	const lineHeight = Number.parseFloat(cssVar("--tr-line-height-default") ?? "") || undefined;
	const paddingTop = Number.parseFloat(cssVar("--space-8") ?? "");
	const options: editor.IStandaloneEditorConstructionOptions = {
		readOnly: true,
		readOnlyMessage: { value: "Files open read-only here — ask the agent to change them." },
		ariaLabel: path,
		unicodeHighlight: { ambiguousCharacters: false },
		lineNumbersMinChars: 3,
		renderLineHighlight: "all",
		smoothScrolling: true,
		guides: { bracketPairs: "active", indentation: true },
		occurrencesHighlight: "singleFile",
		...editorWrappingOptions(lineWidth, bounded),
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		automaticLayout: true,
		fontSize,
		fontFamily: cssVar("--tr-font-family-code") ?? "monospace",
		...(lineHeight && lineHeight > 0 ? { lineHeight } : {}),
		scrollbar: {
			vertical: "auto",
			horizontal: "auto",
			verticalScrollbarSize: 6,
			horizontalScrollbarSize: 6,
			useShadows: false,
		},
		overviewRulerLanes: 0,
		overviewRulerBorder: false,
		hideCursorInOverviewRuler: true,
	};
	options.padding = { top: Number.isFinite(paddingTop) ? paddingTop : 0 };
	return options;
}

function currentTheme(): { registration: ThemeRegistration; base: editor.BuiltinTheme } {
	const root = document.documentElement;
	const styles = getComputedStyle(root);
	const light = styles.colorScheme.split(/\s+/).includes("light");
	const base =
		root.dataset.themeContrast === "high"
			? light
				? "hc-light"
				: "hc-black"
			: light
				? "vs"
				: "vs-dark";
	return {
		base,
		registration: resolveThinkrailShikiTheme({
			name: EDITOR_THEME,
			type: light ? "light" : "dark",
			readVariable: (name) => styles.getPropertyValue(name).trim(),
			toHex: cssColorToHex,
		}),
	};
}

function defineTheme(highlighter: HighlighterCore, base: editor.BuiltinTheme): void {
	const converted = textmateThemeToMonacoTheme(
		highlighter.getTheme(EDITOR_THEME),
	) as editor.IStandaloneThemeData;
	try {
		monaco.editor.defineTheme(EDITOR_THEME, {
			base,
			inherit: true,
			rules: converted.rules,
			colors: converted.colors,
		});
	} catch {
		monaco.editor.defineTheme(EDITOR_THEME, { base, inherit: true, rules: [], colors: {} });
	}
}

let highlighter: HighlighterCore | null = null;
let shikiAdapterInstalled = false;

async function initializeMonaco(): Promise<void> {
	registerShikiLanguages();
	const { registration, base } = currentTheme();
	highlighter = await createHighlighterCore({
		themes: [registration],
		langs: SHIKI_FILE_LANGUAGES.map((language) => language.load()),
		engine: createJavaScriptRegexEngine(),
	});
	if (!shikiAdapterInstalled) {
		shikiToMonaco(highlighter, monaco);
		shikiAdapterInstalled = true;
	}
	defineTheme(highlighter, base);
	monaco.editor.setTheme(EDITOR_THEME);
}

export const monacoSetup = initializeMonaco();

async function refreshTheme(): Promise<void> {
	if (!highlighter) return;
	const { registration, base } = currentTheme();
	await highlighter.loadTheme(registration);
	defineTheme(highlighter, base);
	monaco.editor.setTheme(EDITOR_THEME);
}

export function watchThemeSwap(): () => void {
	return onThemeSwap(() => {
		void refreshTheme().catch(() => monaco.editor.setTheme(EDITOR_THEME));
	});
}
