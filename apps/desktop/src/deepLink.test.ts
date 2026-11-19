import { expect, test } from "bun:test";
import { parseThinkRailDeepLink } from "./deepLink";

test("parses a file path, line and column", () => {
	expect(
		parseThinkRailDeepLink(
			"thinkrail://open?file=/Users/me/thinkrail/apps/web/src/main.tsx&line=12&column=3",
		),
	).toEqual({ file: "/Users/me/thinkrail/apps/web/src/main.tsx", line: 12, column: 3 });
});

test("defaults line to 1 and keeps column optional", () => {
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/src/a.ts")).toEqual({
		file: "/repo/src/a.ts",
		line: 1,
	});
	expect(parseThinkRailDeepLink("thinkrail://open/?file=/repo/src/a.ts&line=7")).toEqual({
		file: "/repo/src/a.ts",
		line: 7,
	});
});

test("decodes percent-encoded and unencoded paths without turning + into a space", () => {
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/a%20b/c.tsx&line=2")).toEqual({
		file: "/repo/a b/c.tsx",
		line: 2,
	});
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/routes/+page.svelte")).toEqual({
		file: "/repo/routes/+page.svelte",
		line: 1,
	});
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/проект/a b.ts")).toEqual({
		file: "/repo/проект/a b.ts",
		line: 1,
	});
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/a%2Bb.ts&line=3")).toEqual({
		file: "/repo/a+b.ts",
		line: 3,
	});
});

test("accepts Windows absolute paths and ignores unknown parameters", () => {
	expect(parseThinkRailDeepLink("thinkrail://open?file=C%3A%5Crepo%5Csrc%5Ca.ts&line=4")).toEqual({
		file: "C:\\repo\\src\\a.ts",
		line: 4,
	});
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/a.ts&source=locator")).toEqual({
		file: "/repo/a.ts",
		line: 1,
	});
});

test("rejects other schemes, hosts, paths and URL parts", () => {
	const invalid = [
		"",
		"https://open?file=/repo/src/a.ts",
		"file:///repo/src/a.ts",
		"thinkrail://other?file=/repo/src/a.ts",
		"thinkrail://open:80?file=/repo/src/a.ts",
		"thinkrail://user@open?file=/repo/src/a.ts",
		"thinkrail://open/run?file=/repo/src/a.ts",
		"thinkrail://open?file=/repo/src/a.ts#L3",
		`thinkrail://open?file=/repo/${"a".repeat(9000)}.ts`,
	];
	for (const raw of invalid) expect(parseThinkRailDeepLink(raw)).toBeNull();
});

test("rejects relative, escaping, ambiguous and malformed file paths", () => {
	const invalid = [
		"thinkrail://open?file=src/a.ts",
		"thinkrail://open?file=",
		"thinkrail://open?file",
		"thinkrail://open?line=3",
		"thinkrail://open?file=/repo/../etc/passwd",
		"thinkrail://open?file=/repo/%2E%2E/etc/passwd",
		"thinkrail://open?file=C%3A%5Crepo%5C..%5Csecret.txt",
		"thinkrail://open?file=/repo/a.ts%00.png",
		"thinkrail://open?file=/repo/a%0A.ts",
		"thinkrail://open?file=/repo/100%.ts",
		"thinkrail://open?file=/repo/a.ts&file=/etc/passwd",
		`thinkrail://open?file=/${"a".repeat(4100)}`,
	];
	for (const raw of invalid) expect(parseThinkRailDeepLink(raw)).toBeNull();
});

test("rejects malformed, zero, negative and huge positions", () => {
	const invalid = [
		"thinkrail://open?file=/repo/src/a.ts&line=0",
		"thinkrail://open?file=/repo/src/a.ts&line=-1",
		"thinkrail://open?file=/repo/src/a.ts&line=1.5",
		"thinkrail://open?file=/repo/src/a.ts&line=1e3",
		"thinkrail://open?file=/repo/src/a.ts&line=",
		"thinkrail://open?file=/repo/src/a.ts&line=2000001",
		"thinkrail://open?file=/repo/src/a.ts&line=99999999999999999999",
		"thinkrail://open?file=/repo/src/a.ts&line=3&line=4",
		"thinkrail://open?file=/repo/src/a.ts&column=0",
		"thinkrail://open?file=/repo/src/a.ts&column=x",
	];
	for (const raw of invalid) expect(parseThinkRailDeepLink(raw)).toBeNull();
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/a.ts&line=2000000")).toEqual({
		file: "/repo/a.ts",
		line: 2_000_000,
	});
});
