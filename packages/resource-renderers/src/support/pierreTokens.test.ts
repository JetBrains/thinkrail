import { describe, expect, test } from "bun:test";
import type { languages } from "monaco-editor/editor/editor.api.js";
import { createPierreTokens, type TokenModel } from "./pierreTokens";

function fakeModel(
	text: string,
	languageId = "typescript",
	size: { lines?: number; length?: number } = {},
) {
	const contentListeners = new Set<() => void>();
	const languageListeners = new Set<() => void>();
	let disposeListener: () => void = () => {};
	let value = text;
	let language = languageId;
	let disposed = false;
	function subscribe(listeners: Set<() => void>, listener: () => void) {
		listeners.add(listener);
		return { dispose: () => listeners.delete(listener) };
	}
	const model = {
		getLanguageId: () => language,
		getLineCount: () => size.lines ?? value.split("\n").length,
		getValue: () => value,
		getValueLength: () => size.length ?? value.length,
		isDisposed: () => disposed,
		onDidChangeContent: (listener: () => void) => subscribe(contentListeners, listener),
		onDidChangeLanguage: (listener: () => void) => subscribe(languageListeners, listener),
		onWillDispose: (listener: () => void) => {
			disposeListener = listener;
			return { dispose: () => {} };
		},
	} as unknown as TokenModel;
	return {
		model,
		setValue(next: string) {
			value = next;
			for (const listener of contentListeners) listener();
		},
		setLanguage(next: string) {
			language = next;
			for (const listener of languageListeners) listener();
		},
		dispose() {
			disposed = true;
			disposeListener();
		},
		listeners: () => contentListeners.size + languageListeners.size,
	};
}

function tokenize(provider: languages.TokensProvider, lines: readonly string[]) {
	let state = provider.getInitialState();
	return lines.map((line) => {
		const result = provider.tokenize(line, state);
		state = result.endState;
		return result.tokens.map((token) => ({
			text: line.slice(token.startIndex),
			scopes: token.scopes,
		}));
	});
}

function scopeAt(tokens: readonly { text: string; scopes: string }[] | undefined, text: string) {
	return tokens?.findLast((token) => token.text.includes(text))?.scopes;
}

async function trackedTokens(...models: readonly TokenModel[]) {
	const tokens = createPierreTokens();
	for (const model of models) tokens.track(model);
	expect(await tokens.ready("typescript")).toBe(true);
	return tokens;
}

describe("createPierreTokens", () => {
	test.each([
		["line count", { lines: 300_001 }, 0],
		["length", { length: 20 * 1024 * 1024 + 1 }, 0],
		["line count at the limit", { lines: 300_000 }, 1],
		["length at the limit", { length: 20 * 1024 * 1024 }, 1],
	])("Monaco's color limit decides the tokenizer: %s", async (_label, size, built) => {
		let tokenizers = 0;
		const tokens = createPierreTokens(async () => {
			const highlights = await import("@pierre/highlights");
			class CountingTokenizer extends highlights.LiveTokenizer {
				constructor(...args: ConstructorParameters<typeof highlights.LiveTokenizer>) {
					tokenizers += 1;
					super(...args);
				}
			}
			return { ...highlights, LiveTokenizer: CountingTokenizer };
		});
		const file = fakeModel("const a = 1;", "typescript", size);
		tokens.track(file.model);
		expect(await tokens.ready("typescript")).toBe(true);
		expect(tokenizers).toBe(built);
		file.setValue("const b = 2;");
		expect(tokenizers).toBe(built);
		const provider = tokens.provider("typescript");
		const scopes = provider.tokenize("const b = 2;", provider.getInitialState()).tokens[0]?.scopes;
		expect(scopes === "").toBe(built === 0);
	});

	test("colours lines and carries a block comment across lines", async () => {
		const lines = ["const a = 1;", "/* open", "still */", "const b = 2;"];
		const tokens = await trackedTokens(fakeModel(lines.join("\n")).model);
		const result = tokenize(tokens.provider("typescript"), lines);
		expect(scopeAt(result[0], "const")).toMatch(/^keyword(\..+)?$/);
		expect(scopeAt(result[2], "still")).toBe("comment");
		expect(scopeAt(result[3], "const")).toMatch(/^keyword(\..+)?$/);
	});

	test("two same-language files with the same first line keep their own colours", async () => {
		const shared = "const shared = 1;";
		const first = [shared, "/* comment", "name */"];
		const second = [shared, "const code = 2;", "name();"];
		const tokens = await trackedTokens(
			fakeModel(first.join("\n")).model,
			fakeModel(second.join("\n")).model,
		);
		const provider = tokens.provider("typescript");
		expect(scopeAt(tokenize(provider, first)[2], "name")).toBe("comment");
		const inSecond = tokenize(provider, second);
		expect(scopeAt(inSecond[1], "const")).toMatch(/^keyword(\..+)?$/);
		expect(scopeAt(inSecond[2], "name")).toBe("function");
		expect(scopeAt(tokenize(provider, first)[2], "name")).toBe("comment");
	});

	test("a state from a closed file moves to the file that still holds the line", async () => {
		const lines = ["const same = 1;", "const next = 2;"];
		const closed = fakeModel(lines.join("\n"));
		const open = fakeModel(lines.join("\n"));
		const tokens = await trackedTokens(closed.model, open.model);
		const provider = tokens.provider("typescript");
		const first = provider.tokenize(lines[0] ?? "", provider.getInitialState());
		closed.dispose();
		const second = provider.tokenize(lines[1] ?? "", first.endState);
		expect(second.tokens[0]?.scopes).toMatch(/^keyword(\..+)?$/);
	});

	test("new text replaces the tokens and invalidates saved line states", async () => {
		const file = fakeModel("const a = 1;");
		const tokens = await trackedTokens(file.model);
		const provider = tokens.provider("typescript");
		const before = provider.tokenize("const a = 1;", provider.getInitialState()).endState;
		file.setValue("// replaced");
		const after = provider.tokenize("// replaced", provider.getInitialState());
		expect(after.tokens[0]?.scopes).toBe("comment");
		expect(after.endState.equals(before)).toBe(false);
	});

	test("closing a file frees its tokenizer and its listeners", async () => {
		const file = fakeModel("const a = 1;");
		const tokens = await trackedTokens(file.model);
		file.dispose();
		expect(file.listeners()).toBe(0);
		const result = tokens.provider("typescript").tokenize("const a = 1;", {
			clone: () => tokens.provider("typescript").getInitialState(),
			equals: () => false,
		});
		expect(result.tokens).toEqual([{ startIndex: 0, scopes: "" }]);
	});

	test("a language change tokenizes the file under the new language", async () => {
		const file = fakeModel("# heading", "typescript");
		const tokens = await trackedTokens(file.model);
		file.setLanguage("python");
		const provider = tokens.provider("python");
		const result = provider.tokenize("# heading", provider.getInitialState());
		expect(result.tokens[0]?.scopes).toBe("comment");
	});

	test("a file opened before and after the load both colour", async () => {
		const tokens = createPierreTokens();
		tokens.track(fakeModel("const a = 1;").model);
		await tokens.ready("typescript");
		tokens.track(fakeModel("let b = 2;").model);
		const provider = tokens.provider("typescript");
		for (const line of ["const a = 1;", "let b = 2;"]) {
			const result = provider.tokenize(line, provider.getInitialState());
			expect(result.tokens[0]?.scopes).toMatch(/^keyword(\..+)?$/);
		}
	});

	test("an unknown language answers false and a failed load retries", async () => {
		let attempts = 0;
		const tokens = createPierreTokens(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("no WebAssembly");
			return import("@pierre/highlights");
		});
		expect(await tokens.ready("typescript")).toBe(false);
		expect(await tokens.ready("typescript")).toBe(true);
		expect(await tokens.ready("not-a-language")).toBe(false);
		expect(attempts).toBe(2);
	});

	test("an over-long line becomes one unscoped token and keeps later lines coloured", async () => {
		const long = `const a = "${"x".repeat(20_000)}";`;
		const lines = [long, "const b = 2;"];
		const tokens = await trackedTokens(fakeModel(lines.join("\n")).model);
		const result = tokenize(tokens.provider("typescript"), lines);
		expect(result[0]).toEqual([{ text: long, scopes: "" }]);
		expect(scopeAt(result[1], "const")).toMatch(/^keyword(\..+)?$/);
	});
});
