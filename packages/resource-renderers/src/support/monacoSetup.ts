/// <reference path="../bundler.d.ts" />
import type { Translator } from "@thinkrail/locales/react";
import type { ThemeRegistration } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import "monaco-editor/features/codicon/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/features/clipboard/register.js";
import "monaco-editor/features/contextmenu/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/features/folding/register.js";
import "monaco-editor/features/hover/register.js";
import "monaco-editor/features/links/register.js";
import "monaco-editor/features/readOnlyMessage/register.js";
import "monaco-editor/features/stickyScroll/register.js";
import "monaco-editor/features/unicodeHighlighter/register.js";
import "monaco-editor/features/wordHighlighter/register.js";
import "monaco-editor/features/quickCommand/register.js";
import "monaco-editor/features/gotoLine/register.js";
import { onThemeSwap } from "@thinkrail/ui/theme";
import type { Environment, editor } from "monaco-editor/editor/editor.api.js";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
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

const EDITOR_THEME = "thinkrail-editor";

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
	code: { fontSize: number; rowHeight: number },
) {
	// The reader's scaled code metrics arrive as values, not as custom properties read here: React
	// cannot see a custom property change, so a memoised caller would keep stale options.
	const fontSize = code.fontSize > 0 ? code.fontSize : 11;
	const lineHeight = code.rowHeight > 0 ? code.rowHeight : undefined;
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

interface FileModelInput {
	scope: string;
	path: string;
	text: string;
}

function fileModelUri({ scope, path }: FileModelInput) {
	return monaco.Uri.parse(`${scope}/${path}`);
}

function createFileModel(input: FileModelInput) {
	return monaco.editor.createModel(input.text, languageForPath(input.path), fileModelUri(input));
}

export function createFileEditor(
	container: HTMLElement,
	{ options, ...model }: FileModelInput & { options: editor.IStandaloneEditorConstructionOptions },
) {
	return monaco.editor.create(container, {
		...options,
		model: createFileModel(model),
		theme: EDITOR_THEME,
	});
}

export function syncFileModel(
	codeEditor: editor.IStandaloneCodeEditor,
	input: FileModelInput,
	appliedText: string,
): void {
	const current = codeEditor.getModel();
	if (!current || current.uri.toString() !== fileModelUri(input).toString()) {
		codeEditor.setModel(createFileModel(input));
		current?.dispose();
		return;
	}
	if (input.text !== appliedText) current.setValue(input.text);
}

export function revealLineNow(codeEditor: editor.IStandaloneCodeEditor, line: number): void {
	codeEditor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
}

export function disposeFileEditor(codeEditor: editor.IStandaloneCodeEditor): void {
	const model = codeEditor.getModel();
	codeEditor.dispose();
	model?.dispose();
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
	if (typeof WebAssembly !== "object") {
		const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
		return createJavaScriptRegexEngine();
	}
	const response = await fetch(onigWasmUrl);
	if (!response.ok) throw new Error(`onig.wasm: HTTP ${response.status}`);
	const onig = await WebAssembly.compile(await response.arrayBuffer());
	return createOnigurumaEngine((imports) => WebAssembly.instantiate(onig, imports));
}

interface MonacoSetup {
	code: ResourceCodeHost;
	tokens: ReturnType<typeof createShikiTokens>;
}

let setup: MonacoSetup | null = null;
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
