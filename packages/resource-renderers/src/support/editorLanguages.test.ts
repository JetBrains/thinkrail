import { describe, expect, test } from "bun:test";
import { isSupportedLanguage } from "@pierre/highlights";
import type { ResourceCodeLanguage } from "../host";
import { editorLanguages } from "./editorLanguages";

const CATALOG: readonly ResourceCodeLanguage[] = [
	{ id: "typescript", extensions: [".ts"], aliases: ["ts"] },
	{ id: "c", extensions: [".c", ".h"], aliases: [] },
	{ id: "markdown", extensions: [".md", ".mdx"], aliases: [] },
	{ id: "docker", extensions: [".dockerfile"], aliases: [], filenames: ["Dockerfile"] },
];

function languageOfExtension(languages: readonly ResourceCodeLanguage[], extension: string) {
	return languages.filter((language) => language.extensions.includes(extension)).map((l) => l.id);
}

describe("editorLanguages", () => {
	const languages = editorLanguages(CATALOG);

	test("catalog files keep their language", () => {
		for (const language of CATALOG) {
			for (const extension of language.extensions) {
				expect(languageOfExtension(languages, extension)).toEqual([language.id]);
			}
		}
		const withDockerfile = languages.filter((l) => l.filenames?.includes("Dockerfile"));
		expect(withDockerfile.map((l) => l.id)).toEqual(["docker"]);
	});

	test("a sample of other languages is found by extension and file name", () => {
		for (const [extension, id] of [
			[".zig", "zig"],
			[".ex", "elixir"],
			[".tf", "tf"],
			[".kdl", "kdl"],
			[".scad", "openscad"],
			[".mbt", "moonbit"],
		] as const) {
			expect(languageOfExtension(languages, extension)).toEqual([id]);
		}
		expect(languages.find((l) => l.filenames?.includes("Justfile"))?.id).toBe("just");
		expect(languages.find((l) => l.filenames?.includes("Makefile"))?.id).toBe("makefile");
	});

	test("one-letter table keys are extensions, not file names", () => {
		expect(languageOfExtension(languages, ".R")).toEqual(["r"]);
	});

	test("a .p file stays Pascal, because Monaco matches extensions without case", () => {
		expect(languageOfExtension(languages, ".p")).toEqual(["pascal"]);
		expect(languageOfExtension(languages, ".P")).toEqual([]);
	});

	test("a .m file opens as Objective-C, and Wolfram keeps its other extensions", () => {
		expect(languageOfExtension(languages, ".m")).toEqual(["objective-c"]);
		expect(languageOfExtension(languages, ".wl")).toEqual(["wolfram"]);
		expect(languageOfExtension(languages, ".nb")).toEqual(["wolfram"]);
		expect(languageOfExtension(languages, ".mm")).toEqual(["objective-cpp"]);
	});

	test("Bazel and Buck file names stay out, because Monaco matches file names without case", () => {
		for (const name of ["BUCK", "BUILD", "PACKAGE", "WORKSPACE"]) {
			expect(languages.filter((l) => l.filenames?.includes(name))).toEqual([]);
			expect(languageOfExtension(languages, `.${name}`)).toEqual([]);
		}
	});

	test("git-rebase-todo is a file name, not an extension", () => {
		expect(languages.find((l) => l.filenames?.includes("git-rebase-todo"))?.id).toBe("git-rebase");
		expect(languageOfExtension(languages, ".git-rebase-todo")).toEqual([]);
	});

	test("an unknown extension and plain text files get no language", () => {
		expect(languageOfExtension(languages, ".zzz")).toEqual([]);
		expect(languageOfExtension(languages, ".txt")).toEqual([]);
	});

	test("every compound key names a language Pierre highlights", () => {
		const compound = languages.filter((l) =>
			l.extensions.some((extension) => extension.lastIndexOf(".") > 0),
		);
		expect(compound.length).toBeGreaterThan(0);
		for (const { id } of compound) expect(isSupportedLanguage(id)).toBe(true);
	});

	test("an id with an extension in the table and in the catalog keeps both once", () => {
		const table = { ts: "typescript", tsx2: "typescript" };
		const [typescript] = editorLanguages(CATALOG.slice(0, 1), table);
		expect(typescript?.extensions).toEqual([".ts", ".tsx2"]);
	});
});
