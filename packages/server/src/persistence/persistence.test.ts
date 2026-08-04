import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, isRemoteTrusted, loadRemoteTrust, noteRemoteTrusted } from "./persistence";

let dir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-persistence-test-"));
	process.env.THINKRAIL_DATA_DIR = dir;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("remote trust is recorded per (project, remote) pair and survives a reload", () => {
	expect(isRemoteTrusted("p1", "origin")).toBe(false);
	noteRemoteTrusted("p1", "origin");
	expect(isRemoteTrusted("p1", "origin")).toBe(true);
	// Neither key is a prefix of the other's namespace: a different project or a different remote is a
	// different pair, and trust must not leak across either axis.
	expect(isRemoteTrusted("p2", "origin")).toBe(false);
	expect(isRemoteTrusted("p1", "upstream")).toBe(false);
});

test("a corrupt remotes.json degrades to no trust rather than throwing", () => {
	mkdirSync(dataDir(), { recursive: true });
	writeFileSync(join(dataDir(), "remotes.json"), "{ not json");
	expect(isRemoteTrusted("p1", "origin")).toBe(false);
	// …and recording still works afterwards, overwriting the corrupt file.
	noteRemoteTrusted("p1", "origin");
	expect(isRemoteTrusted("p1", "origin")).toBe(true);
});

test("the key cannot collide across the projectId/remote boundary", () => {
	// The ONLY test that fails if the NUL separator becomes `:` or a space. With `:`, project "a" + remote
	// "b:c" and project "a:b" + remote "c" produce the identical key — trusting one would silently trust a
	// remote the user never authenticated to.
	noteRemoteTrusted("a", "b:c");
	expect(isRemoteTrusted("a:b", "c")).toBe(false);
	noteRemoteTrusted("x", "y z");
	expect(isRemoteTrusted("x y", "z")).toBe(false);
});

test("noteRemoteTrusted leaves an already-trusted pair's record untouched", () => {
	noteRemoteTrusted("p1", "origin");
	const key = Object.keys(loadRemoteTrust())[0] as string;
	writeFileSync(
		join(dataDir(), "remotes.json"),
		JSON.stringify({ [key]: "1999-01-01T00:00:00.000Z" }),
	);
	noteRemoteTrusted("p1", "origin");
	expect(loadRemoteTrust()[key]).toBe("1999-01-01T00:00:00.000Z");
});
