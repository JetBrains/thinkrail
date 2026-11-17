import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUsageCounters, saveUsageCounters } from "./persistence";

let directory: string;
const saved = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-usage-test-"));
	process.env.THINKRAIL_DATA_DIR = directory;
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
	if (saved === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved;
});

test("usage counters start empty and round-trip", () => {
	expect(loadUsageCounters()).toEqual({ pendingMessages: 0 });
	saveUsageCounters({ lastVersion: "1.0.0", activeDay: "2026-11-16", pendingMessages: 4 });
	expect(loadUsageCounters()).toEqual({
		lastVersion: "1.0.0",
		activeDay: "2026-11-16",
		pendingMessages: 4,
	});
});

test("a malformed usage file is set aside and counting restarts", () => {
	writeFileSync(join(directory, "usage.json"), JSON.stringify({ pendingMessages: -1 }));
	expect(loadUsageCounters()).toEqual({ pendingMessages: 0 });
	expect(readdirSync(directory).some((name) => name.startsWith("usage.json.corrupt-"))).toBe(true);
});
