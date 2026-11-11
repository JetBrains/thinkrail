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
});

test("decodes percent-encoded paths", () => {
	expect(parseThinkRailDeepLink("thinkrail://open?file=/repo/a%20b/c.tsx&line=2")).toEqual({
		file: "/repo/a b/c.tsx",
		line: 2,
	});
});

test("accepts Windows absolute paths", () => {
	expect(parseThinkRailDeepLink("thinkrail://open?file=C%3A%5Crepo%5Csrc%5Ca.ts&line=4")).toEqual({
		file: "C:\\repo\\src\\a.ts",
		line: 4,
	});
});

test("rejects other schemes, hosts, relative paths and malformed positions", () => {
	const invalid = [
		"https://open?file=/repo/src/a.ts",
		"thinkrail://other?file=/repo/src/a.ts",
		"thinkrail://open?file=src/a.ts",
		"thinkrail://open?file=",
		"thinkrail://open?file=/repo/src/a.ts&line=0",
		"thinkrail://open?file=/repo/src/a.ts&line=-1",
		"thinkrail://open?file=/repo/src/a.ts&line=1.5",
		"thinkrail://open?file=/repo/src/a.ts&column=0",
		"thinkrail://open?file=/repo/src/a.ts&column=x",
	];
	for (const raw of invalid) expect(parseThinkRailDeepLink(raw)).toBeNull();
});
