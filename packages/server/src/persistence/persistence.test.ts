import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, isRemoteTrusted, noteRemoteTrusted } from "./persistence";

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
