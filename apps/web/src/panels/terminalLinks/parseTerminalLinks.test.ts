import { describe, expect, test } from "bun:test";
import { parseTerminalLinks, type TerminalLink } from "./parseTerminalLinks";

interface Seen {
	text: string;
	kind: TerminalLink["kind"];
	path: string;
	line?: number;
	col?: number;
}

function links(line: string): Seen[] {
	return parseTerminalLinks(line).map((link) => ({
		text: line.slice(link.start, link.end),
		kind: link.kind,
		path: link.path,
		...(link.line === undefined ? {} : { line: link.line }),
		...(link.col === undefined ? {} : { col: link.col }),
	}));
}

const path = (text: string, target: string, line?: number, col?: number): Seen => ({
	text,
	kind: "path",
	path: target,
	...(line === undefined ? {} : { line }),
	...(col === undefined ? {} : { col }),
});

const url = (text: string): Seen => ({ text, kind: "url", path: text });

describe("compiler and test-runner locations", () => {
	const fixtures: [string, string, Seen[]][] = [
		[
			"tsc",
			"src/a.ts(12,5): error TS2304: Cannot find name 'x'.",
			[path("src/a.ts(12,5)", "src/a.ts", 12, 5)],
		],
		[
			"tsc --pretty",
			"src/a.ts:12:5 - error TS2304: Cannot find name 'x'.",
			[path("src/a.ts:12:5", "src/a.ts", 12, 5)],
		],
		[
			"eslint stylish file header",
			"/home/me/proj/src/a.ts",
			[path("/home/me/proj/src/a.ts", "/home/me/proj/src/a.ts")],
		],
		["eslint stylish problem row", "  12:5  error  'x' is not defined  no-undef", []],
		[
			"eslint compact",
			"src/a.ts: line 12, col 5, Error - 'x' is not defined. (no-undef)",
			[path("src/a.ts: line 12, col 5", "src/a.ts", 12, 5)],
		],
		[
			"eslint unix",
			"src/a.ts:12:5: 'x' is not defined. [Error/no-undef]",
			[path("src/a.ts:12:5", "src/a.ts", 12, 5), path("Error/no-undef", "Error/no-undef")],
		],
		[
			"pytest failure location",
			"tests/x.py:12: AssertionError",
			[path("tests/x.py:12", "tests/x.py", 12)],
		],
		[
			"pytest short summary",
			"FAILED tests/x.py::test_add - assert 1 == 2",
			[path("tests/x.py", "tests/x.py")],
		],
		[
			"python traceback",
			'  File "/home/me/proj/x.py", line 12, in f',
			[path('"/home/me/proj/x.py", line 12', "/home/me/proj/x.py", 12)],
		],
		[
			"python traceback with a space in the path",
			'  File "/home/me/my proj/x.py", line 3, in <module>',
			[path('"/home/me/my proj/x.py", line 3', "/home/me/my proj/x.py", 3)],
		],
		["cargo", "  --> src/main.rs:3:5", [path("src/main.rs:3:5", "src/main.rs", 3, 5)]],
		[
			"rust panic",
			"thread 'main' panicked at src/main.rs:3:5:",
			[path("src/main.rs:3:5", "src/main.rs", 3, 5)],
		],
		["go", "./main.go:10:2: undefined: x", [path("./main.go:10:2", "./main.go", 10, 2)]],
		["bare file with a line", "launcher.py:123", [path("launcher.py:123", "launcher.py", 123)]],
		[
			"gcc",
			"main.c:3:5: error: expected ';' before '}' token",
			[path("main.c:3:5", "main.c", 3, 5)],
		],
		[
			"msbuild",
			"C:\\proj\\src\\Program.cs(12,5): error CS1002: ; expected",
			[path("C:\\proj\\src\\Program.cs(12,5)", "C:\\proj\\src\\Program.cs", 12, 5)],
		],
		[
			"node stack frame",
			"    at main (/home/me/proj/index.js:12:5)",
			[path("/home/me/proj/index.js:12:5", "/home/me/proj/index.js", 12, 5)],
		],
		[
			"node ESM stack frame",
			"    at file:///home/me/proj/x.mjs:3:1",
			[path("file:///home/me/proj/x.mjs:3:1", "/home/me/proj/x.mjs", 3, 1)],
		],
		[
			"vite",
			"[vite] Internal server error: src/App.tsx:4:2: Unexpected token",
			[path("src/App.tsx:4:2", "src/App.tsx", 4, 2)],
		],
	];

	for (const [name, line, expected] of fixtures) {
		test(name, () => {
			expect(links(line)).toEqual(expected);
		});
	}
});

describe("path shapes", () => {
	test("absolute, ./, ../ and ~/ paths are links without a line", () => {
		expect(links("cat /etc/hosts ./a.txt ../lib/util ~/notes/todo.md")).toEqual([
			path("/etc/hosts", "/etc/hosts"),
			path("./a.txt", "./a.txt"),
			path("../lib/util", "../lib/util"),
			path("~/notes/todo.md", "~/notes/todo.md"),
		]);
	});

	test("a bare dir/file and a bare file.ext are candidates", () => {
		expect(links("README.md  package.json  src/components")).toEqual([
			path("README.md", "README.md"),
			path("package.json", "package.json"),
			path("src/components", "src/components"),
		]);
	});

	test("a folder listed with its trailing slash keeps it", () => {
		expect(links("src/  docs/")).toEqual([path("src/", "src/"), path("docs/", "docs/")]);
	});

	test("dotfiles and scoped package paths", () => {
		expect(links(".env.local node_modules/@scope/pkg/index.js")).toEqual([
			path(".env.local", ".env.local"),
			path("node_modules/@scope/pkg/index.js", "node_modules/@scope/pkg/index.js"),
		]);
	});

	test("route folders in brackets stay part of the path", () => {
		expect(links("app/[slug]/page.tsx:8:3")).toEqual([
			path("app/[slug]/page.tsx:8:3", "app/[slug]/page.tsx", 8, 3),
		]);
		expect(links("[src/a.ts]")).toEqual([path("src/a.ts", "src/a.ts")]);
	});

	test("git status and diffstat rows", () => {
		expect(links("\tmodified:   src/a.ts")).toEqual([path("src/a.ts", "src/a.ts")]);
		expect(links(" src/a.ts | 12 +++---")).toEqual([path("src/a.ts", "src/a.ts")]);
	});

	test("an option value is split from its flag", () => {
		expect(links("--outFile=dist/out.js")).toEqual([path("dist/out.js", "dist/out.js")]);
	});

	test("box-drawing and arrow glyphs glued to a path are not part of it", () => {
		expect(links("  ╭─[src/a.ts:3:1]")).toEqual([path("src/a.ts:3:1", "src/a.ts", 3, 1)]);
		expect(links("│src/b.ts └→src/c.ts:2")).toEqual([
			path("src/b.ts", "src/b.ts"),
			path("src/c.ts:2", "src/c.ts", 2),
		]);
	});

	test("unicode names are paths too", () => {
		expect(links("docs/заметки.md:2")).toEqual([path("docs/заметки.md:2", "docs/заметки.md", 2)]);
	});
});

describe("punctuation around paths", () => {
	test("sentence punctuation is not part of the path", () => {
		expect(links("Wrote src/out.json.")).toEqual([path("src/out.json", "src/out.json")]);
		expect(links("see src/a.ts, then src/b.ts;")).toEqual([
			path("src/a.ts", "src/a.ts"),
			path("src/b.ts", "src/b.ts"),
		]);
		expect(links("(see src/a.ts)")).toEqual([path("src/a.ts", "src/a.ts")]);
		expect(links("Cannot find module './util'")).toEqual([path("./util", "./util")]);
	});

	test("a location's trailing colon is not part of it", () => {
		expect(links("src/a.ts:12:")).toEqual([path("src/a.ts:12", "src/a.ts", 12)]);
	});
});

describe("paths with spaces", () => {
	test("are split unless quoted", () => {
		expect(links("my file.ts:3")).toEqual([path("file.ts:3", "file.ts", 3)]);
	});

	test("a quoted path with spaces is one candidate, alongside the pieces inside it", () => {
		expect(links('"my dir/my file.ts":3')).toEqual([
			path('"my dir/my file.ts":3', "my dir/my file.ts", 3),
			path("dir/my", "dir/my"),
			path("file.ts", "file.ts"),
		]);
		expect(links("'docs/release notes.md:12:4'")).toEqual([
			path("'docs/release notes.md:12:4'", "docs/release notes.md", 12, 4),
			path("docs/release", "docs/release"),
			path("notes.md:12:4", "notes.md", 12, 4),
		]);
	});

	test("quoted prose is not a path, but a path inside it still is", () => {
		expect(links("error: 'could not read the config'")).toEqual([]);
		expect(links('"see src/a.ts for details"')).toEqual([
			path('"see src/a.ts for details"', "see src/a.ts for details"),
			path("src/a.ts", "src/a.ts"),
		]);
	});

	test("an apostrophe inside a word does not open a quote", () => {
		expect(links("don't open 'my notes.md' yet")).toEqual([
			path("'my notes.md'", "my notes.md"),
			path("notes.md", "notes.md"),
		]);
	});
});

describe("URLs", () => {
	test("http and https", () => {
		expect(links("Local: http://localhost:5173/ and https://example.com/docs")).toEqual([
			url("http://localhost:5173/"),
			url("https://example.com/docs"),
		]);
	});

	test("trailing punctuation is trimmed", () => {
		expect(links("See https://example.com/docs.")).toEqual([url("https://example.com/docs")]);
		expect(links("https://example.com/a, https://example.com/b;")).toEqual([
			url("https://example.com/a"),
			url("https://example.com/b"),
		]);
		expect(links("'https://example.com/x'")).toEqual([url("https://example.com/x")]);
		expect(links("<https://example.com>")).toEqual([url("https://example.com")]);
	});

	test("a long run of closers is trimmed in linear time", () => {
		const started = performance.now();
		expect(links(`https://example.com/a${")".repeat(20_000)}`)).toEqual([
			url("https://example.com/a"),
		]);
		expect(performance.now() - started).toBeLessThan(200);
	});

	test("parentheses are kept only when balanced", () => {
		expect(links("(https://example.com/a_(b))")).toEqual([url("https://example.com/a_(b)")]);
		expect(links("[docs](https://example.com/docs)")).toEqual([url("https://example.com/docs")]);
		expect(links("https://example.com/x),")).toEqual([url("https://example.com/x")]);
	});

	test("query strings, fragments and ports stay in", () => {
		expect(links("https://example.com:8080/q?a=1&b=2#frag")).toEqual([
			url("https://example.com:8080/q?a=1&b=2#frag"),
		]);
	});

	test("a URL's path is never also read as a file path", () => {
		expect(links("https://github.com/org/repo/blob/main/src/a.ts:12")).toEqual([
			url("https://github.com/org/repo/blob/main/src/a.ts:12"),
		]);
	});

	test("a scheme needs its slashes", () => {
		expect(links("https:")).toEqual([]);
		expect(links("https://")).toEqual([]);
	});
});

describe("not links", () => {
	test("numbers, times and versions", () => {
		expect(links("12:30:45 v1.2.3 1.5 node@20.1.0 2024/01/02 3/4")).toEqual([]);
	});

	test("a lone slash or tilde", () => {
		expect(links("/ ~ ./ ../ -- -->")).toEqual([]);
	});

	test("words without a separator or extension", () => {
		expect(links("error  Something failed  no-undef")).toEqual([]);
	});

	test("an empty line", () => {
		expect(links("")).toEqual([]);
		expect(links("     ")).toEqual([]);
	});
});

describe("line and column numbers", () => {
	test("zero or absurd numbers are dropped rather than trusted", () => {
		expect(links("src/a.ts:0:0")).toEqual([path("src/a.ts:0:0", "src/a.ts")]);
		expect(links("src/a.ts:12:0")).toEqual([path("src/a.ts:12:0", "src/a.ts", 12)]);
		expect(links("src/a.ts:99999999999")).toEqual([path("src/a.ts:99999999999", "src/a.ts")]);
	});

	test("links come back ordered by position", () => {
		const found = parseTerminalLinks("b.ts:2 https://x.dev a.ts:1");
		expect(found.map((link) => link.start)).toEqual(
			[...found.map((link) => link.start)].sort((a, b) => a - b),
		);
	});
});
