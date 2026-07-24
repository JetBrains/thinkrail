import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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

/** Names that are unsafe as a filename segment — must be rejected by `isValidTemplateName` and,
 * transitively, by save/get/delete. Shared between the direct gate tests and the by-name-operation tests
 * below so the two lists can never drift apart. */
const INVALID_NAMES = ["../x", "a/b", "a\\b", ".hidden", ""];

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
	for (const name of INVALID_NAMES) {
		test(`rejects ${JSON.stringify(name)}`, () => {
			expect(isValidTemplateName(name)).toBe(false);
		});
	}

	// Interior dots, uppercase, and spaces are all pi-legal (pi's loader does no sanitization) and must
	// be accepted — this is a traversal gate, not a naming-style rule. "foo.bar" in particular is the
	// case that a former, over-restrictive allowlist regex used to reject.
	for (const name of ["greet", "My_Template-2", "a", "foo.bar", "my template"]) {
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

	test("saveTemplate rejects malformed frontmatter before writing anything (no orphan file)", () => {
		const badContent = "---\nbad: [unterminated\n---\nbody";

		expect(() => saveTemplate(dirs, "global", "broken", badContent)).toThrow();

		expect(existsSync(join(globalDir, "broken.md"))).toBe(false);
	});

	test(
		"a name with an interior dot (foo.bar) round-trips through save -> list -> get -> delete " +
			"(list/get parity: pi lists any *.md with no sanitization, so this module must accept it too)",
		() => {
			const content = "Body for a dotted name.";
			const saved = saveTemplate(dirs, "global", "foo.bar", content);
			expect(saved.name).toBe("foo.bar");

			expect(listTemplates(dirs).map((t) => t.name)).toEqual(["foo.bar"]);
			expect(getTemplate(dirs, "foo.bar").content).toBe(content);

			deleteTemplate(dirs, "global", "foo.bar");
			expect(listTemplates(dirs)).toEqual([]);
		},
	);
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

	test("skips dot-leading filenames entirely (list/get parity: the gate would reject the name too)", () => {
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(join(globalDir, ".hidden.md"), "sneaky");
		saveTemplate(dirs, "global", "visible", "shown");

		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["visible"]);
	});

	test("a scope dir that isn't actually a directory doesn't blank the other scope's listing", () => {
		// A deterministic stand-in for an unreadable directory (EACCES setup is flaky cross-platform):
		// point globalDir at a path that's a plain file. `existsSync` is true, but `readdirSync` throws
		// (ENOTDIR) just like a permissions failure would.
		mkdirSync(join(root, "agent-home"), { recursive: true });
		writeFileSync(globalDir, "not a directory");
		saveTemplate(dirs, "project", "solo", "project body");

		expect(listTemplates(dirs).map((t) => t.name)).toEqual(["solo"]);
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

	test("throws on a directly-named file with malformed frontmatter (asymmetric vs listTemplates's swallow)", () => {
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(join(globalDir, "broken.md"), "---\nbad: [unterminated\n---\nbody");

		expect(() => getTemplate(dirs, "broken", "global")).toThrow();
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
	for (const name of INVALID_NAMES) {
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

// The no-follow gate (SPEC.md "symlink containment"): a checked-out repo can plant
// `.pi/prompts/linked.md → <anywhere>`; no by-name operation may read, overwrite, or act through it —
// a deliberate divergence from pi's read-only scanner, which follows file symlinks.
describe("symlink containment", () => {
	let outsideTarget: string;

	beforeEach(() => {
		outsideTarget = join(root, "outside-secret.txt");
		writeFileSync(outsideTarget, "outside secret — must never be disclosed or clobbered");
		mkdirSync(projectDir, { recursive: true });
		symlinkSync(outsideTarget, join(projectDir, "linked.md"));
	});

	test("listTemplates omits a symlinked entry (dirent isFile is false — no follow)", () => {
		expect(listTemplates(dirs).map((t) => t.name)).not.toContain("linked");
	});

	test("getTemplate treats a symlinked entry as absent — never discloses the target", () => {
		expect(() => getTemplate(dirs, "linked", "project")).toThrow(/not found/);
		// Scope-omitted lookup falls through the project dir the same way (and finds no global either).
		expect(() => getTemplate(dirs, "linked")).toThrow(/not found/);
	});

	test("saveTemplate refuses to write through a symlinked entry — the target stays untouched", () => {
		expect(() => saveTemplate(dirs, "project", "linked", "attacker-chosen content")).toThrow(
			/non-regular file/,
		);
		expect(readFileSync(outsideTarget, "utf-8")).toBe(
			"outside secret — must never be disclosed or clobbered",
		);
	});

	test("deleteTemplate treats a symlinked entry as not-found (it was never listed or fetchable)", () => {
		expect(() => deleteTemplate(dirs, "project", "linked")).toThrow(/not found/);
		expect(existsSync(outsideTarget)).toBe(true);
	});

	test("project-scope writes refuse a symlinked .pi/prompts directory (the same escape one level up)", () => {
		const evilRoot = mkdtempSync(join(tmpdir(), "trpi-templates-evil-"));
		try {
			const elsewhere = join(evilRoot, "elsewhere");
			mkdirSync(elsewhere, { recursive: true });
			const worktreePi = join(evilRoot, "worktree", ".pi");
			mkdirSync(worktreePi, { recursive: true });
			symlinkSync(elsewhere, join(worktreePi, "prompts"));
			const evilDirs: TemplateDirs = { globalDir, projectDir: join(worktreePi, "prompts") };

			expect(() => saveTemplate(evilDirs, "project", "x", "body")).toThrow(/symlinked directory/);
			expect(existsSync(join(elsewhere, "x.md"))).toBe(false);
			expect(() => deleteTemplate(evilDirs, "project", "x")).toThrow(/symlinked directory/);
			// Reads still work through it, matching pi's own loader (which follows the directory too).
			writeFileSync(join(elsewhere, "readable.md"), "readable body");
			expect(getTemplate(evilDirs, "readable", "project").content).toBe("readable body");
		} finally {
			rmSync(evilRoot, { recursive: true, force: true });
		}
	});

	test("the global dir may itself be a symlink (dotfile setups) — writes still work there", () => {
		const realGlobal = join(root, "real-global-prompts");
		mkdirSync(realGlobal, { recursive: true });
		const linkedGlobal = join(root, "linked-global-prompts");
		symlinkSync(realGlobal, linkedGlobal);
		const linkedDirs: TemplateDirs = { globalDir: linkedGlobal, projectDir };

		saveTemplate(linkedDirs, "global", "dotfiled", "body via dir symlink");
		expect(readFileSync(join(realGlobal, "dotfiled.md"), "utf-8")).toBe("body via dir symlink");
		deleteTemplate(linkedDirs, "global", "dotfiled");
		expect(existsSync(join(realGlobal, "dotfiled.md"))).toBe(false);
	});
});

// The client's TemplateEditorDialog populates its form fields from THESE parsed values (never from a
// browser-side YAML reimplementation), so full-YAML scalar fidelity here is what keeps an edit of a
// pi-native template from corrupting its metadata — pin the styles pi accepts beyond bare/double-quoted.
describe("frontmatter value fidelity (pi's real YAML parser)", () => {
	test("a single-quoted scalar parses to its value — quotes are never part of the description", () => {
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(join(globalDir, "sq.md"), "---\ndescription: 'Review safely'\n---\nBody\n");

		expect(getTemplate(dirs, "sq", "global").description).toBe("Review safely");
	});

	test("a folded block scalar parses to its (joined) value, not a literal '>'", () => {
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(
			join(globalDir, "folded.md"),
			"---\ndescription: >-\n  folded description\n  over two lines\n---\nBody\n",
		);

		expect(getTemplate(dirs, "folded", "global").description).toBe(
			"folded description over two lines",
		);
	});
});
