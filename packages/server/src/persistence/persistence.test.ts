import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadHookApprovals,
	loadHookOverrides,
	saveHookApprovals,
	saveHookOverrides,
} from "./persistence";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-persistence-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("loadHookOverrides defaults to an empty object when the file doesn't exist", () => {
	expect(loadHookOverrides()).toEqual({});
});

test("saveHookOverrides then loadHookOverrides round-trips", () => {
	saveHookOverrides({ p1: { onCreate: "pnpm install" } });
	expect(loadHookOverrides()).toEqual({ p1: { onCreate: "pnpm install" } });
});

test("loadHookApprovals defaults to an empty object when the file doesn't exist", () => {
	expect(loadHookApprovals()).toEqual({});
});

test("saveHookApprovals then loadHookApprovals round-trips", () => {
	saveHookApprovals({ p1: { onCreate: { shared: "abc123hash", local: "def456hash" } } });
	expect(loadHookApprovals()).toEqual({
		p1: { onCreate: { shared: "abc123hash", local: "def456hash" } },
	});
});
