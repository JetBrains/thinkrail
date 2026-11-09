/// <reference path="../bundler.d.ts" />
import type { Translator } from "@thinkrail/locales/react";
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
import { fontsLoaded, fontsRevision, type ResolvedFont, resolveFont } from "@thinkrail/ui/fonts";
import { onThemeSwap } from "@thinkrail/ui/theme";
import type { Environment, editor } from "monaco-editor/editor/editor.api.js";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import type { ResourceCodeHost } from "../host";
import { editorWrappingOptions } from "./editorWrapping";
import { createPierreTokens } from "./pierreTokens";

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
const LANGUAGE_PROBE_SCHEME = "lang-probe";

const BRACKETS: [string, string][] = [
	["(", ")"],
	["[", "]"],
	["{", "}"],
];

function registerCatalogLanguages(code: ResourceCodeHost): void {
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

function languageForPath(path: string): string {
	const cached = languageByPath.get(path);
	if (cached !== undefined) return cached;
	const uri = monaco.Uri.parse(`${LANGUAGE_PROBE_SCHEME}://probe/${path}`);
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

let editorFontCache: { revision: string; font: ResolvedFont } | null = null;

export function editorFont(): ResolvedFont {
	const revision = fontsRevision();
	if (editorFontCache?.revision !== revision) {
		editorFontCache = { revision, font: resolveFont("tr-code-editor") };
	}
	return editorFontCache.font;
}

export function remeasureEditorFonts(font: ResolvedFont): void {
	void fontsLoaded(font).then(() => monaco.editor.remeasureFonts());
}

export function fileEditorOptions(
	t: Translator,
	lineWidth: number,
	bounded: boolean,
	path: string,
	font: ResolvedFont,
) {
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
		fontSize: font.size || 11,
		fontFamily: font.family || "monospace",
		fontWeight: String(font.weight || 400),
		fontLigatures: font.ligatures,
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
	return {
		base,
		data: code.editorTheme((name) => styles.getPropertyValue(name).trim()),
	};
}

function defineTheme({ base, data }: ReturnType<typeof currentTheme>): void {
	monaco.editor.defineTheme(EDITOR_THEME, { base, inherit: true, ...data });
	monaco.editor.setTheme(EDITOR_THEME);
}

type EditorTokens = ReturnType<typeof createPierreTokens>;

let ready = false;
const missingProviders = new Set<string>();

function registerTokenProvider(id: string, tokens: EditorTokens): void {
	monaco.languages.registerTokensProviderFactory(id, {
		create: async () => {
			if (await tokens.ready(id)) return tokens.provider(id);
			missingProviders.add(id);
			return null;
		},
	});
}

async function recoverProvider(id: string, tokens: EditorTokens) {
	if (!missingProviders.has(id) || !(await tokens.ready(id))) return;
	missingProviders.delete(id);
	monaco.languages.setTokensProvider(id, tokens.provider(id));
}

function watchModels(tokens: EditorTokens): void {
	monaco.editor.onDidCreateModel((model) => {
		if (model.uri.scheme === LANGUAGE_PROBE_SCHEME) return;
		tokens.track(model);
		void recoverProvider(model.getLanguageId(), tokens);
	});
}

export function ensureMonaco(code: ResourceCodeHost): void {
	if (ready) return;
	const tokens = createPierreTokens();
	registerCatalogLanguages(code);
	for (const { id } of code.languages) registerTokenProvider(id, tokens);
	watchModels(tokens);
	defineTheme(currentTheme(code));
	ready = true;
	onThemeSwap(() => defineTheme(currentTheme(code)));
}
