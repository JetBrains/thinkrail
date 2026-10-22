import { textmateThemeToMonacoTheme } from "@shikijs/monaco";
import type { editor, languages } from "monaco-editor/esm/vs/editor/editor.api.js";
import {
	createHighlighterCore,
	type HighlighterCore,
	normalizeTheme,
	type RegexEngine,
	type ThemeRegistration,
} from "shiki/core";
import { EncodedTokenMetadata, INITIAL, type StateStack } from "shiki/textmate";
import type { ResourceCodeHost, ResourceCodeLanguage } from "../host";

const MAX_LINE_LENGTH = 20_000;
const EMBED_REFERENCE =
	/^[ \t]*(?:(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t]*)*(?:`{3,}|~{3,})[ \t]*\{?\.?([\w#+.-]+)|\blang[ \t]*=[ \t]*["']?([\w#+.-]+)/gm;
const TOKENIZE_TIME_LIMIT_MS = 500;
const IMPLICIT_EMBEDS = [
	[/^-{3,}/, "yaml"],
	[/<[A-Za-z!/]/, "html"],
] as const;
const FENCE_EMBEDS = new Map([
	["h", "c"],
	["cxx", "cpp"],
	["golang", "go"],
	["conf", "ini"],
	["bsh", "java"],
	["jsx", "javascript"],
	["es6", "javascript"],
	["dataviewjs", "javascript"],
	["json5", "json"],
	["py3", "python"],
	["pyw", "python"],
	["rpy", "python"],
	["gyp", "python"],
	["gypi", "python"],
	["rbx", "ruby"],
	["rake", "ruby"],
	["gemfile", "ruby"],
	["profile", "shellscript"],
	["rej", "diff"],
	["xsd", "xml"],
	["shtml", "html"],
	["tpl", "html"],
	["php", "html"],
]);
const FONT_STYLE_BITS = [
	[1, "italic"],
	[2, "bold"],
	[4, "underline"],
	[8, "strikethrough"],
] as const;

interface ShikiTokensOptions extends Pick<ResourceCodeHost, "languageId"> {
	languages: readonly Pick<ResourceCodeLanguage, "id" | "load">[];
	engine: () => Promise<RegexEngine>;
}

class LineState implements languages.IState {
	constructor(readonly ruleStack: StateStack) {}

	clone(): LineState {
		return this;
	}

	equals(other: languages.IState): boolean {
		return other instanceof LineState && other.ruleStack.equals(this.ruleStack);
	}
}

export function monacoThemeData(registration: ThemeRegistration) {
	return textmateThemeToMonacoTheme(normalizeTheme(registration)) as editor.IStandaloneThemeData;
}

function normalizeColor(color: string | undefined): string | undefined {
	if (!color) return undefined;
	const hex = (color.startsWith("#") ? color.slice(1) : color).toLowerCase();
	return hex.length === 3 || hex.length === 4
		? [...hex].map((digit) => digit + digit).join("")
		: hex;
}

function styleKey(color: string, fontStyle: string): string {
	return fontStyle ? `${color}|${fontStyle}` : color;
}

function fontStyleName(bits: number): string {
	return FONT_STYLE_BITS.filter(([bit]) => bits & bit)
		.map(([, name]) => name)
		.join(" ");
}

export function createShikiTokens({ languages: catalog, languageId, engine }: ShikiTokensOptions) {
	const byId = new Map(catalog.map((language) => [language.id, language]));
	const loads = new Map<string, Promise<readonly string[] | null>>();
	const embedded = new Map<string, Set<string>>();
	const scopeByStyle = new Map<string, string>();
	const scopeByMetadata = new Map<number, string>();
	let colorMap: readonly (string | undefined)[] = [];
	let theme: ThemeRegistration | null = null;
	let themeRules: readonly editor.ITokenThemeRule[] = [];
	let selectedName = "";
	let highlighter: HighlighterCore | null = null;
	let creating: Promise<HighlighterCore | null> | null = null;

	async function selectTheme(hl: HighlighterCore, registration: ThemeRegistration) {
		const base = registration.name ?? "theme";
		const name = selectedName === `${base}#a` ? `${base}#b` : `${base}#a`;
		await hl.loadTheme({ ...registration, name });
		if (registration !== theme) return;
		colorMap = hl.setTheme(name).colorMap.map(normalizeColor);
		selectedName = name;
		scopeByStyle.clear();
		scopeByMetadata.clear();
		for (const rule of themeRules) {
			const color = normalizeColor(rule.foreground);
			if (!color) continue;
			const key = styleKey(color, rule.fontStyle ?? "");
			if (!scopeByStyle.has(key)) scopeByStyle.set(key, rule.token);
		}
	}

	function highlighterReady() {
		creating ??= engine()
			.then((regexEngine) => createHighlighterCore({ themes: [], langs: [], engine: regexEngine }))
			.then(async (hl) => {
				highlighter = hl;
				if (theme) await selectTheme(hl, theme);
				return hl;
			})
			.catch(() => {
				creating = null;
				return null;
			});
		return creating;
	}

	function loadGrammar(id: string) {
		let load = loads.get(id);
		if (load) return load;
		const language = byId.get(id);
		if (!language) return Promise.resolve(null);
		load = Promise.all([highlighterReady(), language.load()])
			.then(async ([hl, module]) => {
				if (!hl) throw new Error("highlighter unavailable");
				await hl.loadLanguage(module.default);
				const own = module.default.find((registration) => registration.name === id);
				return own?.embeddedLangsLazy?.filter((embed) => byId.has(embed)) ?? [];
			})
			.catch(() => {
				loads.delete(id);
				return null;
			});
		loads.set(id, load);
		return load;
	}

	async function ready(id: string) {
		return (await loadGrammar(id)) !== null;
	}

	function referencedLanguages(text: string) {
		const ids = new Set<string>();
		for (const [pattern, id] of IMPLICIT_EMBEDS) if (pattern.test(text)) ids.add(id);
		for (const [, fence, attribute] of text.matchAll(EMBED_REFERENCE)) {
			const fenceId = fence ? FENCE_EMBEDS.get(fence.toLowerCase()) : undefined;
			if (fenceId) ids.add(fenceId);
			const id = languageId(fence ?? attribute ?? "");
			if (id) ids.add(id);
		}
		return ids;
	}

	async function loadEmbeds(id: string, source: () => string) {
		const embeds = await loadGrammar(id);
		if (!embeds?.length) return false;
		const referenced = referencedLanguages(source());
		const seen = embedded.get(id) ?? new Set<string>();
		embedded.set(id, seen);
		const visited = new Set([id]);
		let changed = false;
		let frontier: readonly string[] = embeds;
		while (frontier.length > 0) {
			const wanted = frontier.filter((embed) => referenced.has(embed) && !visited.has(embed));
			for (const embed of wanted) visited.add(embed);
			const nested = await Promise.all(
				wanted.map(async (embed) => {
					const own = await loadGrammar(embed);
					if (own === null) return [];
					if (!seen.has(embed)) {
						seen.add(embed);
						changed = true;
					}
					return own;
				}),
			);
			frontier = nested.flat();
		}
		return changed;
	}

	function scopeOf(metadata: number) {
		const foreground = EncodedTokenMetadata.getForeground(metadata);
		const fontBits = EncodedTokenMetadata.getFontStyle(metadata);
		const key = foreground * 16 + fontBits;
		const cached = scopeByMetadata.get(key);
		if (cached !== undefined) return cached;
		const color = colorMap[foreground];
		const scope = color ? (scopeByStyle.get(styleKey(color, fontStyleName(fontBits))) ?? "") : "";
		scopeByMetadata.set(key, scope);
		return scope;
	}

	function provider(id: string): languages.TokensProvider {
		const grammar = highlighter?.getLanguage(id) ?? null;
		return {
			getInitialState: () => new LineState(INITIAL),
			tokenize(line, state) {
				const current = state instanceof LineState ? state : new LineState(INITIAL);
				if (line.length >= MAX_LINE_LENGTH || !grammar) {
					return { endState: current, tokens: [{ startIndex: 0, scopes: "" }] };
				}
				const result = grammar.tokenizeLine2(line, current.ruleStack, TOKENIZE_TIME_LIMIT_MS);
				const tokens: languages.IToken[] = [];
				for (let index = 0; index < result.tokens.length; index += 2) {
					tokens.push({
						startIndex: result.tokens[index] ?? 0,
						scopes: scopeOf(result.tokens[index + 1] ?? 0),
					});
				}
				return { endState: new LineState(result.ruleStack), tokens };
			},
		};
	}

	async function applyTheme(
		registration: ThemeRegistration,
		rules: readonly editor.ITokenThemeRule[],
	) {
		theme = registration;
		themeRules = rules;
		if (highlighter) await selectTheme(highlighter, registration);
	}

	return { ready, loadEmbeds, provider, applyTheme };
}
