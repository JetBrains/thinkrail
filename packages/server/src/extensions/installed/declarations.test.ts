import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extensionSourceKind, folderOf, readDeclarations, writeDeclarations } from "./declarations";
import { tempDir } from "./testFixtures";

describe("extensionSourceKind", () => {
	it.each([
		["npm:thinkrail-ext-weather", "npm"],
		["npm:@jane/weather@1.2.0", "npm"],
		["git:github.com/jane/weather", "git"],
		["https://github.com/jane/weather", "git"],
		["ssh://git@github.com/jane/weather", "git"],
		["file:///Users/jane/weather", "folder"],
		["ftp://example.com/x", undefined],
		["/Users/jane/weather", "folder"],
		["~/weather", "folder"],
		["npm:", undefined],
		["./weather", undefined],
		["weather", undefined],
	])("reads %s as %p", (source, kind) => {
		expect(extensionSourceKind(source)).toBe(kind as ReturnType<typeof extensionSourceKind>);
	});

	it("expands a home folder", () => {
		expect(folderOf("~/weather")).toBe(join(homedir(), "weather"));
		expect(folderOf("/a/./b")).toBe("/a/b");
		expect(folderOf("file:///a/b")).toBe("/a/b");
	});
});

describe("readDeclarations", () => {
	it("treats a missing file as no extensions", () => {
		expect(readDeclarations(join(tempDir(), "extensions.json"))).toEqual({
			ok: true,
			sources: [],
			fields: {},
		});
	});

	it("trims and deduplicates sources", () => {
		const path = join(tempDir(), "extensions.json");
		writeFileSync(path, '\uFEFF{ "extensions": [" npm:a ", "npm:a", "", "/b"] }');
		const read = readDeclarations(path);
		expect(read.ok && read.sources).toEqual(["npm:a", "/b"]);
	});

	it.each([
		["{", "not valid JSON"],
		["[]", "must be"],
		['{ "extensions": "npm:a" }', "list of source strings"],
		['{ "extensions": [1] }', "list of source strings"],
	])("refuses %s", (body, message) => {
		const path = join(tempDir(), "extensions.json");
		writeFileSync(path, body);
		const read = readDeclarations(path);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error).toContain(message);
	});

	it("rewrites the list and keeps the other keys", () => {
		const path = join(tempDir(), "extensions.json");
		writeFileSync(path, JSON.stringify({ note: "kept", extensions: ["npm:a"] }));
		const read = readDeclarations(path);
		if (!read.ok) throw new Error(read.error);
		writeDeclarations(path, read, ["npm:a", "/b"]);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			note: "kept",
			extensions: ["npm:a", "/b"],
		});
	});
});
