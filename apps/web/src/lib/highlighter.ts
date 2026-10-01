import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "@/themes";

interface ShikiLanguageModule {
	default: LanguageRegistration[];
}

export interface ShikiFileLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
	chat?: boolean;
	load: () => Promise<ShikiLanguageModule>;
}

export const SHIKI_FILE_LANGUAGES: readonly ShikiFileLanguage[] = [
	{
		id: "typescript",
		extensions: [".ts", ".cts", ".mts"],
		aliases: ["TypeScript", "ts", "cts", "mts"],
		chat: true,
		load: () => import("@shikijs/langs/typescript"),
	},
	{
		id: "tsx",
		extensions: [".tsx"],
		aliases: ["TSX"],
		chat: true,
		load: () => import("@shikijs/langs/tsx"),
	},
	{
		id: "javascript",
		extensions: [".js", ".cjs", ".mjs"],
		aliases: ["JavaScript", "js", "cjs", "mjs"],
		chat: true,
		load: () => import("@shikijs/langs/javascript"),
	},
	{
		id: "jsx",
		extensions: [".jsx"],
		aliases: ["JSX"],
		chat: true,
		load: () => import("@shikijs/langs/jsx"),
	},
	{
		id: "json",
		extensions: [".json"],
		aliases: ["JSON"],
		chat: true,
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
		chat: true,
		load: () => import("@shikijs/langs/bash"),
	},
	{
		id: "python",
		extensions: [".py", ".pyw", ".pyi"],
		aliases: ["Python", "py"],
		chat: true,
		load: () => import("@shikijs/langs/python"),
	},
	{
		id: "css",
		extensions: [".css"],
		aliases: ["CSS"],
		chat: true,
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
		chat: true,
		load: () => import("@shikijs/langs/html"),
	},
	{
		id: "markdown",
		extensions: [".md", ".markdown", ".mdown", ".mkdn", ".mdx"],
		aliases: ["Markdown", "md"],
		chat: true,
		load: () => import("@shikijs/langs/markdown"),
	},
	{
		id: "yaml",
		extensions: [".yaml", ".yml"],
		aliases: ["YAML", "yml"],
		chat: true,
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
		chat: true,
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

const CHAT_SHIKI_LANGUAGES = SHIKI_FILE_LANGUAGES.filter((language) => language.chat);
const CHAT_LANGUAGE_BY_ALIAS = new Map(
	CHAT_SHIKI_LANGUAGES.flatMap((language) =>
		[language.id, ...language.aliases].map((alias) => [alias.toLowerCase(), language.id] as const),
	),
);

let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [THINKRAIL_SHIKI_THEME],
		langs: CHAT_SHIKI_LANGUAGES.map((language) => language.load()),
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string | null> {
	const canonical = CHAT_LANGUAGE_BY_ALIAS.get(lang.toLowerCase());
	if (!canonical) return null;
	try {
		const hl = await getHighlighter();
		return hl.codeToHtml(code, { lang: canonical, theme: THINKRAIL_SHIKI_THEME_NAME });
	} catch {
		return null;
	}
}
