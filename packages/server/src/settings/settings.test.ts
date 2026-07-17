import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, Theme } from "@thinkrail/contracts";
import { getConfig, resetConfigCache, setSettingsPublisher, updateConfig } from "./settings";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-settings-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache(); // never carry a prior test's cache into this fresh data dir
});

afterEach(() => {
	setSettingsPublisher(null); // never leak a test's publisher into the next
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("getConfig falls back to DEFAULT_CONFIG when no config.json exists", () => {
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});

test("updateConfig merges, persists to config.json, and returns the merged config", () => {
	const next = updateConfig({ theme: Theme.Darcula });
	expect(next.theme).toBe(Theme.Darcula);
	// Persisted to disk.
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.theme).toBe(Theme.Darcula);
	// Cached: a re-read reflects it without touching disk again.
	expect(getConfig().theme).toBe(Theme.Darcula);
});

test("updateConfig broadcasts the new config through the injected publisher", () => {
	const seen: string[] = [];
	setSettingsPublisher((c) => seen.push(c.theme));
	updateConfig({ theme: Theme.Light });
	expect(seen).toEqual([Theme.Light]);
});

test("a null publisher makes updates silent no-ops (still persisted)", () => {
	setSettingsPublisher(null);
	expect(() => updateConfig({ theme: Theme.Light })).not.toThrow();
	expect(existsSync(join(dataDir, "config.json"))).toBe(true);
});

test("loadConfig degrades a partial/corrupt file over DEFAULT_CONFIG", () => {
	writeFileSync(join(dataDir, "config.json"), "{ not json");
	resetConfigCache();
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});
