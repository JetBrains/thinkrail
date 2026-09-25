/// <reference path="./textImports.d.ts" />

import { createHash } from "node:crypto";
import { compile } from "tailwindcss";
import tailwindTheme from "tailwindcss/theme.css" with { type: "text" };
import { APP_THEME_CSS } from "./appTheme.generated";

const INPUT = [
	"@layer theme, base, components, utilities;",
	'@import "tailwindcss/theme.css" layer(theme);',
	'@import "tailwindcss/utilities.css" layer(utilities);',
	APP_THEME_CSS,
].join("\n");

const STYLESHEETS: Readonly<Record<string, string>> = {
	"tailwindcss/theme.css": tailwindTheme,
	"tailwindcss/utilities.css": "@tailwind utilities;",
};

const CACHE_LIMIT = 64;
const MAX_CANDIDATE_LENGTH = 160;
const cache = new Map<string, Promise<string>>();

const extractCandidates = (source: string) => {
	const found = new Set<string>();
	for (const [token] of source.matchAll(/[^\s"'`\\<>{};]+/g))
		if (token.length <= MAX_CANDIDATE_LENGTH && /[a-z]/.test(token)) found.add(token);
	return [...found].sort();
};

const loadStylesheet = async (id: string, base: string) => {
	const content = STYLESHEETS[id];
	if (content === undefined) throw new Error(`extension CSS cannot import "${id}"`);
	return { path: id, base, content };
};

const compileCandidates = async (candidates: string[]) => {
	const compiler = await compile(INPUT, { base: "/", loadStylesheet });
	return compiler.build(candidates);
};

export const compileExtensionCss = (source: string) => {
	const candidates = extractCandidates(source);
	const key = createHash("sha256").update(candidates.join("\n")).digest("hex");
	const cached = cache.get(key);
	if (cached) return cached;
	const built = compileCandidates(candidates);
	cache.set(key, built);
	built.catch(() => cache.delete(key));
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return built;
};
