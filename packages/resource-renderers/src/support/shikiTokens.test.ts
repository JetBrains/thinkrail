import { describe, expect, test } from "bun:test";
import type { languages } from "monaco-editor/esm/vs/editor/editor.api.js";
import type { LanguageRegistration, ThemeRegistration } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { createShikiTokens, monacoThemeData } from "./shikiTokens";

const CATALOG = [
	{ id: "typescript", load: () => import("shiki/langs/typescript.mjs") },
	{ id: "markdown", load: () => import("shiki/langs/markdown.mjs") },
	{ id: "shellscript", load: () => import("shiki/langs/bash.mjs") },
	{ id: "javascript", load: () => import("shiki/langs/javascript.mjs") },
	{ id: "yaml", load: () => import("shiki/langs/yaml.mjs") },
	{ id: "html", load: () => import("shiki/langs/html-derivative.mjs") },
];
const ALIASES = new Map([
	["ts", "typescript"],
	["typescript", "typescript"],
	["md", "markdown"],
	["markdown", "markdown"],
	["sh", "shellscript"],
	["bash", "shellscript"],
	["shellscript", "shellscript"],
	["js", "javascript"],
	["javascript", "javascript"],
	["yaml", "yaml"],
	["html", "html"],
]);
const FENCE = ["# hi", "```ts", "const x = 1", "```"];

function languageId(value: string) {
	return ALIASES.get(value.toLowerCase()) ?? null;
}

async function themeNamed(load: Promise<{ default: ThemeRegistration }>) {
	return { ...(await load).default, name: "editor" };
}

const light = themeNamed(import("shiki/themes/github-light.mjs"));
const dark = themeNamed(import("shiki/themes/github-dark.mjs"));

function engine() {
	return createOnigurumaEngine(import("shiki/wasm"));
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

function applyTheme(tokens: ReturnType<typeof createShikiTokens>, theme: ThemeRegistration) {
	return tokens.applyTheme(theme, monacoThemeData(theme).rules);
}

function countingCatalog(counts: Map<string, number>) {
	return CATALOG.map((language) => ({
		...language,
		load: () => {
			counts.set(language.id, (counts.get(language.id) ?? 0) + 1);
			return language.load();
		},
	}));
}

function scopeOf(
	tokens: readonly { text: string; scopes: string }[] | undefined,
	prefix: string,
): string | undefined {
	return tokens?.find((token) => token.text.startsWith(prefix))?.scopes;
}

async function themedTokens(catalog = CATALOG) {
	const tokens = createShikiTokens({ languages: catalog, languageId, engine });
	await applyTheme(tokens, await light);
	return tokens;
}

describe("createShikiTokens", () => {
	test("concurrent first uses of a language load its grammar once", async () => {
		let loads = 0;
		const tokens = await themedTokens([
			{
				id: "typescript",
				load: () => {
					loads += 1;
					return import("shiki/langs/typescript.mjs");
				},
			},
		]);
		const results = await Promise.all([tokens.ready("typescript"), tokens.ready("typescript")]);
		expect(results).toEqual([true, true]);
		expect(loads).toBe(1);
	});

	test("an unknown language resolves false without loading anything", async () => {
		const tokens = await themedTokens();
		expect(await tokens.ready("klingon")).toBe(false);
		expect(await tokens.loadEmbeds("klingon", () => "```ts")).toBe(false);
	});

	test("a failed grammar load resolves false and the next call retries", async () => {
		let attempts = 0;
		const tokens = await themedTokens([
			{
				id: "typescript",
				load: (): Promise<{ default: LanguageRegistration[] }> => {
					attempts += 1;
					return attempts === 1
						? Promise.reject(new Error("chunk failed"))
						: import("shiki/langs/typescript.mjs");
				},
			},
		]);
		expect(await tokens.ready("typescript")).toBe(false);
		expect(await tokens.ready("typescript")).toBe(true);
		expect(attempts).toBe(2);
	});

	test("an engine that fails leaves every language plain", async () => {
		const tokens = createShikiTokens({
			languages: CATALOG,
			languageId,
			engine: () => Promise.reject(new Error("no wasm")),
		});
		expect(await tokens.ready("typescript")).toBe(false);
	});

	test("every catalog id resolves its own grammar name", async () => {
		const tokens = await themedTokens();
		for (const { id } of CATALOG) expect(await tokens.ready(id), id).toBe(true);
		const [line] = tokenize(tokens.provider("shellscript"), ["echo hi"]);
		expect(line?.some((token) => token.scopes !== "")).toBe(true);
	});

	test("the provider maps TypeScript tokens to theme scopes across a theme swap", async () => {
		const tokens = await themedTokens();
		await tokens.ready("typescript");
		const [before] = tokenize(tokens.provider("typescript"), ["const x = 1"]);
		expect(scopeOf(before, "const")).toBeTruthy();

		await applyTheme(tokens, await dark);
		const [after] = tokenize(tokens.provider("typescript"), ["const x = 1"]);
		expect(scopeOf(after, "const")).toBeTruthy();
		expect(scopeOf(after, "1")).toBeTruthy();
	});

	test("swapping back to an earlier theme and racing swaps select the newest theme", async () => {
		const marker = (scope: string, foreground: string): ThemeRegistration => ({
			name: "editor",
			type: "light",
			settings: [{ scope: [scope, "storage"], settings: { foreground } }],
		});
		const alpha = marker("alpha", "#ff0000");
		const beta = marker("beta", "#00ff00");
		const tokens = await themedTokens();
		await tokens.ready("typescript");
		const keyword = () => scopeOf(tokenize(tokens.provider("typescript"), ["const x"])[0], "const");

		await applyTheme(tokens, alpha);
		expect(keyword()).toBe("alpha");
		await applyTheme(tokens, beta);
		expect(keyword()).toBe("beta");
		await applyTheme(tokens, alpha);
		expect(keyword()).toBe("alpha");
		await Promise.all([applyTheme(tokens, beta), applyTheme(tokens, alpha)]);
		expect(keyword()).toBe("alpha");
	});

	test("markdown fences colour once the referenced embeds load", async () => {
		const tokens = await themedTokens();
		await tokens.ready("markdown");
		const plainFence = scopeOf(tokenize(tokens.provider("markdown"), FENCE)[2], "const");

		expect(await tokens.loadEmbeds("markdown", () => FENCE.join("\n"))).toBe(true);
		const keyword = scopeOf(tokenize(tokens.provider("typescript"), ["const x = 1"])[0], "const");
		const colouredFence = scopeOf(tokenize(tokens.provider("markdown"), FENCE)[2], "const");
		expect(colouredFence).toBe(keyword);
		expect(colouredFence).not.toBe(plainFence);
	});

	test("embeds load only for fence languages the text references, once", async () => {
		const counts = new Map<string, number>();
		const tokens = await themedTokens(countingCatalog(counts));
		expect(await tokens.loadEmbeds("markdown", () => "# no fences")).toBe(false);
		expect(counts.get("typescript")).toBeUndefined();
		expect(counts.get("shellscript")).toBeUndefined();

		const text = () => FENCE.join("\n");
		expect(await tokens.loadEmbeds("markdown", text)).toBe(true);
		expect(await tokens.loadEmbeds("markdown", text)).toBe(false);
		expect(counts.get("typescript")).toBe(1);
		expect(counts.get("shellscript")).toBeUndefined();
	});

	test("fences inside quotes and lists and spaced lang attributes count as references", async () => {
		for (const text of [
			["> ```ts", "> const x = 1", "> ```"],
			["- ```ts", "  const x = 1", "  ```"],
			["1. > ```ts", "   > const x = 1", "   > ```"],
			['<script lang = "ts">', "const x = 1", "</script>"],
		]) {
			const counts = new Map<string, number>();
			const tokens = await themedTokens(countingCatalog(counts));
			expect(await tokens.loadEmbeds("markdown", () => text.join("\n"))).toBe(true);
			expect(counts.get("typescript")).toBe(1);
		}
	});

	test("front matter and inline HTML colour without a fence reference", async () => {
		const counts = new Map<string, number>();
		const tokens = await themedTokens(countingCatalog(counts));
		const text = ["---", "name: demo", "---", "", '<p align="center">', "<kbd>Ctrl</kbd>", "</p>"];
		await tokens.ready("markdown");
		const before = tokenize(tokens.provider("markdown"), text);
		expect(before[1]).toHaveLength(1);
		expect(before[4]).toHaveLength(1);

		expect(await tokens.loadEmbeds("markdown", () => text.join("\n"))).toBe(true);
		const after = tokenize(tokens.provider("markdown"), text);
		expect(scopeOf(after[1], "name")).toBeTruthy();
		expect(scopeOf(after[4], "p")).toBeTruthy();
		expect(scopeOf(after[5], "kbd")).toBeTruthy();
		expect(counts.get("yaml")).toBe(1);
		expect(counts.get("html")).toBe(1);
		expect(counts.get("typescript")).toBeUndefined();
	});

	test("a fence alias the markdown grammar embeds under another language colours", async () => {
		const counts = new Map<string, number>();
		const tokens = await themedTokens(countingCatalog(counts));
		const text = ["```jsx", "const x = 1", "```"];
		expect(await tokens.loadEmbeds("markdown", () => text.join("\n"))).toBe(true);
		const keyword = scopeOf(tokenize(tokens.provider("javascript"), ["const x = 1"])[0], "const");
		expect(scopeOf(tokenize(tokens.provider("markdown"), text)[1], "const")).toBe(keyword);
		expect(keyword).toBeTruthy();
		expect(counts.get("javascript")).toBe(1);
	});

	test("a provider keeps the grammar its line states came from after embeds rebuild it", async () => {
		const tokens = await themedTokens();
		await tokens.ready("markdown");
		const provider = tokens.provider("markdown");
		let state = provider.getInitialState();
		for (const line of FENCE.slice(0, 2)) state = provider.tokenize(line, state).endState;

		await tokens.loadEmbeds("markdown", () => FENCE.join("\n"));
		expect(() => provider.tokenize("const x = 1", state)).not.toThrow();
	});

	test("an over-long line becomes one unscoped token", async () => {
		const tokens = await themedTokens();
		await tokens.ready("typescript");
		const [line] = tokenize(tokens.provider("typescript"), ["x".repeat(20_000)]);
		expect(line).toEqual([{ text: "x".repeat(20_000), scopes: "" }]);
	});
});
