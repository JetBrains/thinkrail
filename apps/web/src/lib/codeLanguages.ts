export interface CodeLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
	{
		id: "typescript",
		extensions: [".ts", ".cts", ".mts"],
		aliases: ["TypeScript", "ts", "cts", "mts"],
	},
	{
		id: "tsx",
		extensions: [".tsx"],
		aliases: ["TSX"],
	},
	{
		id: "javascript",
		extensions: [".js", ".cjs", ".mjs"],
		aliases: ["JavaScript", "js", "cjs", "mjs"],
	},
	{
		id: "jsx",
		extensions: [".jsx"],
		aliases: ["JSX"],
	},
	{
		id: "json",
		extensions: [".json"],
		aliases: ["JSON"],
	},
	{
		id: "jsonc",
		extensions: [".jsonc", ".code-workspace"],
		aliases: ["JSON with Comments"],
	},
	{
		id: "shellscript",
		extensions: [".sh", ".bash", ".zsh"],
		aliases: ["Shell", "shell", "bash", "sh", "zsh"],
	},
	{
		id: "python",
		extensions: [".py", ".pyw", ".pyi"],
		aliases: ["Python", "py"],
	},
	{
		id: "css",
		extensions: [".css"],
		aliases: ["CSS"],
	},
	{
		id: "scss",
		extensions: [".scss"],
		aliases: ["SCSS", "Sass"],
	},
	{
		id: "html",
		extensions: [".html", ".htm", ".xhtml", ".shtml"],
		aliases: ["HTML", "htm", "xhtml"],
	},
	{
		id: "markdown",
		extensions: [".md", ".markdown", ".mdown", ".mkdn", ".mdx"],
		aliases: ["Markdown", "md"],
	},
	{
		id: "yaml",
		extensions: [".yaml", ".yml"],
		aliases: ["YAML", "yml"],
	},
	{
		id: "toml",
		extensions: [".toml"],
		aliases: ["TOML"],
	},
	{
		id: "rust",
		extensions: [".rs"],
		aliases: ["Rust", "rs"],
	},
	{
		id: "go",
		extensions: [".go"],
		aliases: ["Go"],
	},
	{
		id: "java",
		extensions: [".java"],
		aliases: ["Java"],
	},
	{
		id: "kotlin",
		extensions: [".kt", ".kts"],
		aliases: ["Kotlin", "kt", "kts"],
	},
	{
		id: "scala",
		extensions: [".scala"],
		aliases: ["Scala"],
	},
	{
		id: "swift",
		extensions: [".swift"],
		aliases: ["Swift"],
	},
	{
		id: "c",
		extensions: [".c", ".h"],
		aliases: ["C"],
	},
	{
		id: "cpp",
		extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
		aliases: ["C++", "c++"],
	},
	{
		id: "csharp",
		extensions: [".cs", ".csx", ".cake"],
		aliases: ["C#", "c#", "cs"],
	},
	{
		id: "sql",
		extensions: [".sql"],
		aliases: ["SQL"],
	},
	{
		id: "xml",
		extensions: [".xml", ".xsd", ".xsl", ".xslt", ".svg"],
		aliases: ["XML"],
	},
	{
		id: "docker",
		extensions: [".dockerfile"],
		aliases: ["Dockerfile", "dockerfile"],
		filenames: ["Dockerfile", "Containerfile"],
	},
	{
		id: "ini",
		extensions: [".ini", ".properties", ".gitconfig", ".editorconfig"],
		aliases: ["INI", "properties"],
	},
	{
		id: "diff",
		extensions: [".diff", ".patch"],
		aliases: ["Diff", "Patch"],
	},
	{
		id: "graphql",
		extensions: [".graphql", ".gql"],
		aliases: ["GraphQL", "gql"],
	},
	{
		id: "vue",
		extensions: [".vue"],
		aliases: ["Vue"],
	},
	{
		id: "svelte",
		extensions: [".svelte"],
		aliases: ["Svelte"],
	},
	{
		id: "astro",
		extensions: [".astro"],
		aliases: ["Astro"],
	},
	{
		id: "prisma",
		extensions: [".prisma"],
		aliases: ["Prisma"],
	},
	{
		id: "lua",
		extensions: [".lua"],
		aliases: ["Lua"],
	},
	{
		id: "ruby",
		extensions: [".rb", ".rbx", ".rake", ".gemspec"],
		aliases: ["Ruby", "rb"],
		filenames: ["Rakefile", "Gemfile"],
	},
	{
		id: "php",
		extensions: [".php", ".php4", ".php5", ".phtml"],
		aliases: ["PHP"],
	},
];

const CODE_LANGUAGE_BY_ALIAS = new Map(
	CODE_LANGUAGES.flatMap((language) =>
		[language.id, ...language.aliases].map((alias) => [alias.toLowerCase(), language.id] as const),
	),
);
export function codeLanguageId(value: string): string | null {
	return CODE_LANGUAGE_BY_ALIAS.get(value.trim().toLowerCase()) ?? null;
}
