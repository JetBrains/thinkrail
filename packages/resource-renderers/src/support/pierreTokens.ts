import type { LiveTokenizer, Theme } from "@pierre/highlights";
import type { editor, languages } from "monaco-editor/editor/editor.api.js";

type Highlights = typeof import("@pierre/highlights");

export type TokenModel = Pick<
	editor.ITextModel,
	| "getLanguageId"
	| "getLineCount"
	| "getValue"
	| "getValueLength"
	| "isDisposed"
	| "onDidChangeContent"
	| "onDidChangeLanguage"
	| "onWillDispose"
>;

interface TokenDocument {
	tokenizer: LiveTokenizer;
	languageId: string;
	revision: number;
	alive: boolean;
}

const MAX_LINE_LENGTH = 20_000;
const MAX_MODEL_LENGTH = 20 * 1024 * 1024;
const MAX_MODEL_LINES = 300_000;
const UNSTYLED_TOKEN = "none";
const SCOPE_ONLY_THEME: Theme = { name: "thinkrail-editor-scopes", appearance: "dark", style: {} };

class LineState implements languages.IState {
	readonly document: TokenDocument | null;
	readonly line: number;
	readonly revision: number;

	constructor(document: TokenDocument | null, line: number, revision: number) {
		this.document = document;
		this.line = line;
		this.revision = revision;
	}

	clone(): LineState {
		return this;
	}

	equals(other: languages.IState): boolean {
		return (
			other instanceof LineState &&
			other.document === this.document &&
			other.line === this.line &&
			other.revision === this.revision
		);
	}
}

const INITIAL_STATE = new LineState(null, 0, 0);

function holdsLine({ tokenizer }: TokenDocument, line: number, text: string) {
	return line < tokenizer.lineCount && tokenizer.getLineText(line) === text;
}

function samePrefix(first: TokenDocument, second: TokenDocument, lines: number) {
	if (lines > first.tokenizer.lineCount || lines > second.tokenizer.lineCount) return false;
	for (let line = 0; line < lines; line += 1) {
		if (first.tokenizer.getLineText(line) !== second.tokenizer.getLineText(line)) return false;
	}
	return true;
}

function lineTokens({ tokenizer }: TokenDocument, line: number, scopes: readonly string[]) {
	const { data, format } = tokenizer.getLineRecords(line);
	const packed = format === "packed24";
	const tokens: languages.IToken[] = [];
	let start = 0;
	for (let index = 0; index < data.length; index += packed ? 1 : 2) {
		const word = data[index] ?? 0;
		const end = packed ? word & 0xffffff : word;
		const tokenId = packed ? word >>> 24 : (data[index + 1] ?? 0);
		if (end > start) tokens.push({ startIndex: start, scopes: scopes[tokenId] ?? "" });
		start = end;
	}
	return tokens.length > 0 ? tokens : [{ startIndex: 0, scopes: "" }];
}

export function createPierreTokens(
	load: () => Promise<Highlights> = () => import("@pierre/highlights"),
) {
	const models = new Set<TokenModel>();
	const documents = new Map<TokenModel, TokenDocument>();
	let highlights: Highlights | null = null;
	let loading: Promise<Highlights | null> | null = null;

	function detach(model: TokenModel) {
		const document = documents.get(model);
		if (!document) return;
		documents.delete(model);
		document.alive = false;
		document.tokenizer.dispose();
	}

	function attach(model: TokenModel) {
		detach(model);
		const languageId = model.getLanguageId();
		if (!highlights?.isSupportedLanguage(languageId) || model.isDisposed()) return;
		if (model.getValueLength() > MAX_MODEL_LENGTH || model.getLineCount() > MAX_MODEL_LINES) return;
		documents.set(model, {
			tokenizer: new highlights.LiveTokenizer({
				lang: languageId,
				theme: SCOPE_ONLY_THEME,
				code: model.getValue(),
			}),
			languageId,
			revision: 0,
			alive: true,
		});
	}

	function refresh(model: TokenModel) {
		const document = documents.get(model);
		if (!document) return;
		document.tokenizer.reset(model.getValue());
		document.revision += 1;
	}

	function ensureLoaded() {
		loading ??= load()
			.then((loaded) => {
				highlights = loaded;
				for (const model of models) attach(model);
				return loaded;
			})
			.catch(() => {
				loading = null;
				return null;
			});
		return loading;
	}

	function track(model: TokenModel) {
		models.add(model);
		if (highlights) attach(model);
		const subscriptions = [
			model.onDidChangeContent(() => refresh(model)),
			model.onDidChangeLanguage(() => attach(model)),
		];
		model.onWillDispose(() => {
			for (const subscription of subscriptions) subscription.dispose();
			models.delete(model);
			detach(model);
		});
	}

	function documentFor(languageId: string, { document, line }: LineState, text: string) {
		const current = document?.alive ? document : null;
		if (current && holdsLine(current, line, text)) return current;
		for (const candidate of documents.values()) {
			if (candidate === current || candidate.languageId !== languageId) continue;
			if (!holdsLine(candidate, line, text)) continue;
			if (!current || samePrefix(current, candidate, line)) return candidate;
		}
		return current;
	}

	function provider(languageId: string): languages.TokensProvider {
		const scopes = (highlights?.tokenNames ?? []).map((name) =>
			name === UNSTYLED_TOKEN ? "" : name,
		);
		return {
			getInitialState: () => INITIAL_STATE,
			tokenize(text, state) {
				const previous = state instanceof LineState ? state : INITIAL_STATE;
				const document = documentFor(languageId, previous, text);
				const { line } = previous;
				const endState = new LineState(document, line + 1, document?.revision ?? 0);
				const colored =
					document && text.length < MAX_LINE_LENGTH && holdsLine(document, line, text);
				return {
					endState,
					tokens: colored ? lineTokens(document, line, scopes) : [{ startIndex: 0, scopes: "" }],
				};
			},
		};
	}

	async function ready(languageId: string) {
		const loaded = await ensureLoaded();
		return loaded?.isSupportedLanguage(languageId) ?? false;
	}

	return { ready, track, provider };
}
