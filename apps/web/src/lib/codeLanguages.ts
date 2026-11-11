export interface CodeLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
	{
		id: "typescript",
		extensions: [],
		aliases: ["TypeScript", "ts", "cts", "mts"],
	},
	{
		id: "tsx",
		extensions: [],
		aliases: ["TSX"],
	},
	{
		id: "javascript",
		extensions: [],
		aliases: ["JavaScript", "js", "cjs", "mjs"],
	},
	{
		id: "jsx",
		extensions: [],
		aliases: ["JSX"],
	},
	{
		id: "json",
		extensions: [],
		aliases: ["JSON"],
	},
	{
		id: "jsonc",
		extensions: [".code-workspace"],
		aliases: ["JSON with Comments"],
	},
	{
		id: "shellscript",
		extensions: [".sh", ".bash", ".zsh"],
		aliases: ["Shell", "shell", "bash", "sh", "zsh"],
	},
	{
		id: "python",
		extensions: [],
		aliases: ["Python", "py"],
	},
	{
		id: "css",
		extensions: [],
		aliases: ["CSS"],
	},
	{
		id: "scss",
		extensions: [],
		aliases: ["SCSS", "Sass"],
	},
	{
		id: "html",
		extensions: [".xhtml", ".shtml"],
		aliases: ["HTML", "htm", "xhtml"],
	},
	{
		id: "markdown",
		extensions: [".mdown", ".mkdn"],
		aliases: ["Markdown", "md"],
	},
	{
		id: "yaml",
		extensions: [".yml"],
		aliases: ["YAML", "yml"],
	},
	{
		id: "toml",
		extensions: [],
		aliases: ["TOML"],
	},
	{
		id: "rust",
		extensions: [],
		aliases: ["Rust", "rs"],
	},
	{
		id: "go",
		extensions: [],
		aliases: ["Go"],
	},
	{
		id: "java",
		extensions: [],
		aliases: ["Java"],
	},
	{
		id: "kotlin",
		extensions: [".kts"],
		aliases: ["Kotlin", "kt", "kts"],
	},
	{
		id: "scala",
		extensions: [],
		aliases: ["Scala"],
	},
	{
		id: "swift",
		extensions: [],
		aliases: ["Swift"],
	},
	{
		id: "c",
		extensions: [".h"],
		aliases: ["C"],
	},
	{
		id: "cpp",
		extensions: [".hxx"],
		aliases: ["C++", "c++"],
	},
	{
		id: "csharp",
		extensions: [".csx", ".cake"],
		aliases: ["C#", "c#", "cs"],
	},
	{
		id: "sql",
		extensions: [],
		aliases: ["SQL"],
	},
	{
		id: "xml",
		extensions: [".xsd", ".xsl", ".xslt", ".svg"],
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
		extensions: [".properties", ".gitconfig", ".editorconfig"],
		aliases: ["INI", "properties"],
	},
	{
		id: "diff",
		extensions: [],
		aliases: ["Diff", "Patch"],
	},
	{
		id: "graphql",
		extensions: [],
		aliases: ["GraphQL", "gql"],
	},
	{
		id: "vue",
		extensions: [],
		aliases: ["Vue"],
	},
	{
		id: "svelte",
		extensions: [],
		aliases: ["Svelte"],
	},
	{
		id: "astro",
		extensions: [],
		aliases: ["Astro"],
	},
	{
		id: "prisma",
		extensions: [],
		aliases: ["Prisma"],
	},
	{
		id: "lua",
		extensions: [],
		aliases: ["Lua"],
	},
	{
		id: "ruby",
		extensions: [".rbx"],
		aliases: ["Ruby", "rb"],
	},
	{
		id: "php",
		extensions: [".php4", ".php5"],
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
