/// <reference path="../bundler.d.ts" />
import { loader } from "@monaco-editor/react";
import type { Translator } from "@thinkrail/locales/react";
import type { ThemeRegistration } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
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
import onigWasmUrl from "shiki/onig.wasm?url";
import type { ResourceCodeHost } from "../host";
import { editorWrappingOptions } from "./editorWrapping";
import { createShikiTokens, monacoThemeData } from "./shikiTokens";

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

function registerShikiLanguages(code: ResourceCodeHost): void {
	const registered = new Set(monaco.languages.getLanguages().map((language) => language.id));
	for (const language of code.languages) {
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

export function fileEditorOptions(
	t: Translator,
	lineWidth: number,
	bounded: boolean,
	path: string,
) {
	const fontSize = Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
	const lineHeight = Number.parseFloat(cssVar("--tr-line-height-default") ?? "") || undefined;
	const paddingTop = Number.parseFloat(cssVar("--space-8") ?? "");
	const options: editor.IStandaloneEditorConstructionOptions = {
		readOnly: true,
		readOnlyMessage: { value: t("panels.monacoSetup.readOnly") },
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

function themeData(registration: ThemeRegistration) {
	try {
		const { rules, colors } = monacoThemeData(registration);
		return { rules, colors };
	} catch {
		return { rules: [], colors: {} };
	}
}

function currentTheme(code: ResourceCodeHost) {
	const root = document.documentElement;
	const styles = getComputedStyle(root);
	const light = styles.colorScheme.split(/\s+/).includes("light");
	const base: editor.BuiltinTheme =
		root.dataset.themeContrast === "high"
			? light
				? "hc-light"
				: "hc-black"
			: light
				? "vs"
				: "vs-dark";
	const registration = code.theme({
		name: EDITOR_THEME,
		type: light ? "light" : "dark",
		readVariable: (name) => styles.getPropertyValue(name).trim(),
	});
	return { base, registration, data: themeData(registration) };
}

function defineTheme({ base, data }: ReturnType<typeof currentTheme>): void {
	monaco.editor.defineTheme(EDITOR_THEME, { base, inherit: true, ...data });
	monaco.editor.setTheme(EDITOR_THEME);
}

async function createEngine() {
	try {
		return await createOnigurumaEngine(fetch(onigWasmUrl));
	} catch {
		const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
		return createJavaScriptRegexEngine();
	}
}

interface MonacoSetup {
	code: ResourceCodeHost;
	tokens: ReturnType<typeof createShikiTokens>;
}

let setup: MonacoSetup | null = null;
// Monaco asks a language's factory for a provider only once, so a grammar whose first load failed
// gets its provider installed by the next model that loads it successfully.
const missingProviders = new Set<string>();

function registerTokenProvider(id: string, tokens: MonacoSetup["tokens"]): void {
	monaco.languages.registerTokensProviderFactory(id, {
		create: async () => {
			if (await tokens.ready(id)) return tokens.provider(id);
			missingProviders.add(id);
			return null;
		},
	});
}

async function recoverProvider(id: string, tokens: MonacoSetup["tokens"]) {
	return missingProviders.has(id) && (await tokens.ready(id)) && missingProviders.delete(id);
}

function loadModelEmbeds(model: editor.ITextModel, tokens: MonacoSetup["tokens"]): void {
	const id = model.getLanguageId();
	void Promise.all([
		recoverProvider(id, tokens),
		tokens.loadEmbeds(id, () => (model.isDisposed() ? "" : model.getValue())),
	]).then(([recovered, loaded]) => {
		if (recovered || loaded) monaco.languages.setTokensProvider(id, tokens.provider(id));
	});
}

function watchModelEmbeds(tokens: MonacoSetup["tokens"]): void {
	monaco.editor.onDidCreateModel((model) => {
		loadModelEmbeds(model, tokens);
		const subscriptions = [
			model.onDidChangeContent(() => loadModelEmbeds(model, tokens)),
			model.onDidChangeLanguage(() => loadModelEmbeds(model, tokens)),
		];
		model.onWillDispose(() => {
			for (const subscription of subscriptions) subscription.dispose();
		});
	});
}

export function ensureMonaco(code: ResourceCodeHost): void {
	if (setup) return;
	const tokens = createShikiTokens({
		languages: code.languages,
		languageId: (value) => code.languageId(value),
		engine: createEngine,
	});
	registerShikiLanguages(code);
	for (const { id } of code.languages) registerTokenProvider(id, tokens);
	watchModelEmbeds(tokens);
	const theme = currentTheme(code);
	void tokens.applyTheme(theme.registration, theme.data.rules);
	defineTheme(theme);
	setup = { code, tokens };
	onThemeSwap(() => {
		void refreshTheme(code, tokens).catch(() => monaco.editor.setTheme(EDITOR_THEME));
	});
}

export function warmLanguage(id: string): void {
	setup?.tokens.warm(id);
}

async function refreshTheme(code: ResourceCodeHost, tokens: MonacoSetup["tokens"]): Promise<void> {
	const theme = currentTheme(code);
	await tokens.applyTheme(theme.registration, theme.data.rules);
	defineTheme(theme);
}
