import {
	createHighlighterCore,
	type HighlighterCore,
	type LanguageRegistration,
	type RegexEngine,
} from "shiki/core";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "@/themes";

interface ShikiLanguageModule {
	default: LanguageRegistration[];
}

export interface ShikiFileLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
	load: () => Promise<ShikiLanguageModule>;
}

export const SHIKI_FILE_LANGUAGES: readonly ShikiFileLanguage[] = [
	{
		id: "typescript",
		extensions: [".ts", ".cts", ".mts"],
		aliases: ["TypeScript", "ts", "cts", "mts"],
		load: () => import("@shikijs/langs/typescript"),
	},
	{
		id: "tsx",
		extensions: [".tsx"],
		aliases: ["TSX"],
		load: () => import("@shikijs/langs/tsx"),
	},
	{
		id: "javascript",
		extensions: [".js", ".cjs", ".mjs"],
		aliases: ["JavaScript", "js", "cjs", "mjs"],
		load: () => import("@shikijs/langs/javascript"),
	},
	{
		id: "jsx",
		extensions: [".jsx"],
		aliases: ["JSX"],
		load: () => import("@shikijs/langs/jsx"),
	},
	{
		id: "json",
		extensions: [".json"],
		aliases: ["JSON"],
		load: () => import("@shikijs/langs/json"),
	},
	{
		id: "jsonc",
		extensions: [".jsonc", ".code-workspace"],
		aliases: ["JSON with Comments"],
		load: () => import("@shikijs/langs/jsonc"),
	},
	{
		id: "shellscript",
		extensions: [".sh", ".bash", ".zsh"],
		aliases: ["Shell", "shell", "bash", "sh", "zsh"],
		load: () => import("@shikijs/langs/bash"),
	},
	{
		id: "python",
		extensions: [".py", ".pyw", ".pyi"],
		aliases: ["Python", "py"],
		load: () => import("@shikijs/langs/python"),
	},
	{
		id: "css",
		extensions: [".css"],
		aliases: ["CSS"],
		load: () => import("@shikijs/langs/css"),
	},
	{
		id: "scss",
		extensions: [".scss"],
		aliases: ["SCSS", "Sass"],
		load: () => import("@shikijs/langs/scss"),
	},
	{
		id: "html",
		extensions: [".html", ".htm", ".xhtml", ".shtml"],
		aliases: ["HTML", "htm", "xhtml"],
		load: () => import("@shikijs/langs/html-derivative"),
	},
	{
		id: "markdown",
		extensions: [".md", ".markdown", ".mdown", ".mkdn", ".mdx"],
		aliases: ["Markdown", "md"],
		load: () => import("@shikijs/langs/markdown"),
	},
	{
		id: "yaml",
		extensions: [".yaml", ".yml"],
		aliases: ["YAML", "yml"],
		load: () => import("@shikijs/langs/yaml"),
	},
	{
		id: "toml",
		extensions: [".toml"],
		aliases: ["TOML"],
		load: () => import("@shikijs/langs/toml"),
	},
	{
		id: "rust",
		extensions: [".rs"],
		aliases: ["Rust", "rs"],
		load: () => import("@shikijs/langs/rust"),
	},
	{
		id: "go",
		extensions: [".go"],
		aliases: ["Go"],
		load: () => import("@shikijs/langs/go"),
	},
	{
		id: "java",
		extensions: [".java"],
		aliases: ["Java"],
		load: () => import("@shikijs/langs/java"),
	},
	{
		id: "kotlin",
		extensions: [".kt", ".kts"],
		aliases: ["Kotlin", "kt", "kts"],
		load: () => import("@shikijs/langs/kotlin"),
	},
	{
		id: "scala",
		extensions: [".scala"],
		aliases: ["Scala"],
		load: () => import("@shikijs/langs/scala"),
	},
	{
		id: "swift",
		extensions: [".swift"],
		aliases: ["Swift"],
		load: () => import("@shikijs/langs/swift"),
	},
	{
		id: "c",
		extensions: [".c", ".h"],
		aliases: ["C"],
		load: () => import("@shikijs/langs/c"),
	},
	{
		id: "cpp",
		extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
		aliases: ["C++", "c++"],
		load: () => import("@shikijs/langs/cpp"),
	},
	{
		id: "csharp",
		extensions: [".cs", ".csx", ".cake"],
		aliases: ["C#", "c#", "cs"],
		load: () => import("@shikijs/langs/csharp"),
	},
	{
		id: "sql",
		extensions: [".sql"],
		aliases: ["SQL"],
		load: () => import("@shikijs/langs/sql"),
	},
	{
		id: "xml",
		extensions: [".xml", ".xsd", ".xsl", ".xslt", ".svg"],
		aliases: ["XML"],
		load: () => import("@shikijs/langs/xml"),
	},
	{
		id: "docker",
		extensions: [".dockerfile"],
		aliases: ["Dockerfile", "dockerfile"],
		filenames: ["Dockerfile", "Containerfile"],
		load: () => import("@shikijs/langs/dockerfile"),
	},
	{
		id: "ini",
		extensions: [".ini", ".properties", ".gitconfig", ".editorconfig"],
		aliases: ["INI", "properties"],
		load: () => import("@shikijs/langs/ini"),
	},
	{
		id: "diff",
		extensions: [".diff", ".patch"],
		aliases: ["Diff", "Patch"],
		load: () => import("@shikijs/langs/diff"),
	},
	{
		id: "graphql",
		extensions: [".graphql", ".gql"],
		aliases: ["GraphQL", "gql"],
		load: () => import("@shikijs/langs/graphql"),
	},
	{
		id: "vue",
		extensions: [".vue"],
		aliases: ["Vue"],
		load: () => import("@shikijs/langs/vue"),
	},
	{
		id: "svelte",
		extensions: [".svelte"],
		aliases: ["Svelte"],
		load: () => import("@shikijs/langs/svelte"),
	},
	{
		id: "astro",
		extensions: [".astro"],
		aliases: ["Astro"],
		load: () => import("@shikijs/langs/astro"),
	},
	{
		id: "prisma",
		extensions: [".prisma"],
		aliases: ["Prisma"],
		load: () => import("@shikijs/langs/prisma"),
	},
	{
		id: "lua",
		extensions: [".lua"],
		aliases: ["Lua"],
		load: () => import("@shikijs/langs/lua"),
	},
	{
		id: "ruby",
		extensions: [".rb", ".rbx", ".rake", ".gemspec"],
		aliases: ["Ruby", "rb"],
		filenames: ["Rakefile", "Gemfile"],
		load: () => import("@shikijs/langs/ruby"),
	},
	{
		id: "php",
		extensions: [".php", ".php4", ".php5", ".phtml"],
		aliases: ["PHP"],
		load: () => import("@shikijs/langs/php"),
	},
];

const SHIKI_LANGUAGE_BY_ALIAS = new Map(
	SHIKI_FILE_LANGUAGES.flatMap((language) =>
		[language.id, ...language.aliases].map((alias) => [alias.toLowerCase(), language] as const),
	),
);

function shikiLanguage(value: string) {
	return SHIKI_LANGUAGE_BY_ALIAS.get(value.trim().toLowerCase());
}

export function shikiLanguageId(value: string): string | null {
	return shikiLanguage(value)?.id ?? null;
}

export function createChatHighlighter(engine: () => RegexEngine | Promise<RegexEngine>) {
	let highlighterPromise: Promise<HighlighterCore> | null = null;
	const languageLoads = new Map<string, Promise<void>>();

	function getHighlighter() {
		highlighterPromise ??= createHighlighterCore({
			themes: [THINKRAIL_SHIKI_THEME],
			langs: [],
			engine: engine(),
		}).catch((error: unknown) => {
			highlighterPromise = null;
			throw error;
		});
		return highlighterPromise;
	}

	function loadLanguage(hl: HighlighterCore, language: ShikiFileLanguage) {
		let load = languageLoads.get(language.id);
		if (!load) {
			load = hl.loadLanguage(language.load()).catch((error: unknown) => {
				languageLoads.delete(language.id);
				throw error;
			});
			languageLoads.set(language.id, load);
		}
		return load;
	}

	return async function highlight(code: string, lang: string) {
		const language = shikiLanguage(lang);
		if (!language) return null;
		const hl = await getHighlighter();
		try {
			await loadLanguage(hl, language);
			return hl.codeToHtml(code, { lang: language.id, theme: THINKRAIL_SHIKI_THEME_NAME });
		} catch {
			return null;
		}
	};
}
