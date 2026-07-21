import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deleteTemplate,
	getTemplate,
	isValidTemplateName,
	listTemplates,
	saveTemplate,
	type TemplateDirs,
	templateDirs,
} from "./templates";

let root: string;
let globalDir: string;
let projectDir: string;
let dirs: TemplateDirs;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-templates-test-"));
	globalDir = join(root, "agent-home", "prompts");
	projectDir = join(root, "worktree", ".pi", "prompts");
	dirs = { globalDir, projectDir };
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("templateDirs", () => {
	test("computes globalDir under agentDir/prompts and projectDir under cwd/.pi/prompts", () => {
		const result = templateDirs("/some/cwd", "/some/agent-dir");
		expect(result.globalDir).toBe(join("/some/agent-dir", "prompts"));
		expect(result.projectDir).toBe(join("/some/cwd", ".pi", "prompts"));
	});

	test("projectDir is absent when cwd is omitted", () => {
		const result = templateDirs(undefined, "/some/agent-dir");
		expect(result.projectDir).toBeUndefined();
	});
});

describe("isValidTemplateName", () => {
	for (const name of ["../x", "a/b", ".hidden", ""]) {
		test(`rejects ${JSON.stringify(name)}`, () => {
			expect(isValidTemplateName(name)).toBe(false);
		});
	}

	for (const name of ["greet", "My_Template-2", "a"]) {
		test(`accepts ${JSON.stringify(name)}`, () => {
			expect(isValidTemplateName(name)).toBe(true);
		});
	}
});

describe("saveTemplate -> listTemplates -> getTemplate", () => {
	test("round-trips frontmatter, surfacing description/argumentHint, content = full file text", () => {
		const content = [
			"---",
			"description: Say hi",
			"argument-hint: <name>",
			"---",
			"",
			"Hello $1",
		].join("\n");

		const saved = saveTemplate(dirs, "global", "greet", content);
		expect(saved).toEqual({
			name: "greet",
			description: "Say hi",
			argumentHint: "<name>",
			content,
			scope: "global",
			filePath: join(globalDir, "greet.md"),
		});

		const listed = listTemplates(dirs);
		expect(listed).toEqual([saved]);

		expect(getTemplate(dirs, "greet")).toEqual(saved);
		expect(getTemplate(dirs, "greet", "global")).toEqual(saved);
	});

	test("a template with no frontmatter round-trips (content = body, no description/argumentHint)", () => {
		const content = "Just a plain body, no frontmatter here.";
		const saved = saveTemplate(dirs, "project", "plain", content);

		expect(saved.content).toBe(content);
		expect(saved.description).toBeUndefined();
		expect(saved.argumentHint).toBeUndefined();
		expect(getTemplate(dirs, "plain", "project").content).toBe(content);
	});

	test("saveTemplate creates the scope dir if missing and writes content verbatim", () => {
		expect(existsSync(globalDir)).toBe(false);
		const content = "line one\nline two\n";

		saveTemplate(dirs, "global", "fresh", content);

		expect(readFileSync(join(globalDir, "fresh.md"), "utf-8")).toBe(content);
	});

	test("saveTemplate overwrites an existing template", () => {
		saveTemplate(dirs, "global", "dup", "first version");
		const second = saveTemplate(dirs, "global", "dup", "second version");

		expect(second.content).toBe("second version");
		expect(getTemplate(dirs, "dup", "global").content).toBe("second version");
	});
});

describe("listTemplates precedence + freshness", () => {
	test("missing dirs -> empty list", () => {
		expect(listTemplates(dirs)).toEqual([]);
	});

	test("project entries shadow same-named global ones", () => {
		saveTemplate(dirs, "global", "dup", "global body");
		saveTemplate(dirs, "project", "dup", "project body");

		const listed = listTemplates(dirs);

		expect(listed).toHaveLength(1);
		expect(listed[0]?.scope).toBe("project");
		expect(listed[0]?.content).toBe("project body");
	});

	test("non-colliding entries from both dirs are all present, sorted by name", () => {
		saveTemplate(dirs, "global", "bbb", "b");
		saveTemplate(dirs, "project", "aaa", "a");
		saveTemplate(dirs, "global", "ccc", "c");

		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["aaa", "bbb", "ccc"]);
	});

	test("reflects a save that happens between two calls (no caching)", () => {
		expect(listTemplates(dirs)).toEqual([]);
		saveTemplate(dirs, "global", "late", "arrived after the first list() call");
		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["late"]);
	});

	test("skips a file it can't parse (malformed frontmatter) without throwing, keeps the rest", () => {
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(join(globalDir, "broken.md"), "---\nbad: [unterminated\n---\nbody");
		saveTemplate(dirs, "global", "ok", "a fine template");

		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["ok"]);
	});
});

describe("getTemplate", () => {
	test("scope disambiguates a name collision", () => {
		saveTemplate(dirs, "global", "dup", "global body");
		saveTemplate(dirs, "project", "dup", "project body");

		expect(getTemplate(dirs, "dup", "global").content).toBe("global body");
		expect(getTemplate(dirs, "dup", "project").content).toBe("project body");
	});

	test("scope-omitted get follows project-over-global precedence", () => {
		saveTemplate(dirs, "global", "dup", "global body");
		saveTemplate(dirs, "project", "dup", "project body");

		expect(getTemplate(dirs, "dup").content).toBe("project body");
	});

	test("scope-omitted get falls back to global when there's no project entry", () => {
		saveTemplate(dirs, "global", "solo", "global body");

		expect(getTemplate(dirs, "solo").content).toBe("global body");
	});

	test("throws when the template is absent", () => {
		expect(() => getTemplate(dirs, "missing")).toThrow();
		expect(() => getTemplate(dirs, "missing", "global")).toThrow();
		expect(() => getTemplate(dirs, "missing", "project")).toThrow();
	});
});

describe("deleteTemplate", () => {
	test("removes exactly one file, leaving siblings untouched", () => {
		saveTemplate(dirs, "global", "keep", "keep me");
		saveTemplate(dirs, "global", "gone", "delete me");

		deleteTemplate(dirs, "global", "gone");

		expect(existsSync(join(globalDir, "gone.md"))).toBe(false);
		expect(existsSync(join(globalDir, "keep.md"))).toBe(true);
		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["keep"]);
	});

	test("only removes the file in the given scope, not a same-named file in the other scope", () => {
		saveTemplate(dirs, "global", "dup", "global body");
		saveTemplate(dirs, "project", "dup", "project body");

		deleteTemplate(dirs, "global", "dup");

		expect(existsSync(join(globalDir, "dup.md"))).toBe(false);
		expect(existsSync(join(projectDir, "dup.md"))).toBe(true);
	});

	test("throws when the template is absent", () => {
		expect(() => deleteTemplate(dirs, "global", "missing")).toThrow();
	});
});

describe("invalid names are rejected on save/get/delete", () => {
	for (const name of ["../x", "a/b", ".hidden", ""]) {
		test(`rejects ${JSON.stringify(name)}`, () => {
			expect(() => saveTemplate(dirs, "global", name, "x")).toThrow();
			expect(() => getTemplate(dirs, name, "global")).toThrow();
			expect(() => getTemplate(dirs, name)).toThrow();
			expect(() => deleteTemplate(dirs, "global", name)).toThrow();
		});
	}
});

describe("project ops without a projectDir throw", () => {
	test('saveTemplate/getTemplate/deleteTemplate all throw for scope "project"', () => {
		const globalOnly: TemplateDirs = { globalDir };

		expect(() => saveTemplate(globalOnly, "project", "x", "content")).toThrow();
		expect(() => getTemplate(globalOnly, "x", "project")).toThrow();
		expect(() => deleteTemplate(globalOnly, "project", "x")).toThrow();
	});

	test("scope-omitted getTemplate does not throw — it simply can't find a project entry", () => {
		const globalOnly: TemplateDirs = { globalDir };
		saveTemplate(globalOnly, "global", "solo", "global body");

		expect(getTemplate(globalOnly, "solo").content).toBe("global body");
	});
});
