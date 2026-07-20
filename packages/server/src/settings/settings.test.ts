import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
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

test("updateConfig merges, persists an opaque theme id, and returns the merged config", () => {
	const opaqueTheme = "acme.solarized";
	const next = updateConfig({ theme: opaqueTheme });
	expect(next.theme).toBe(opaqueTheme);
	// Persisted to disk without requiring a server-side theme catalog.
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.theme).toBe(opaqueTheme);
	// Cached: a re-read reflects it without touching disk again.
	expect(getConfig().theme).toBe(opaqueTheme);
});

test("updateConfig broadcasts the new config through the injected publisher", () => {
	const seen: string[] = [];
	setSettingsPublisher((c) => seen.push(c.theme));
	updateConfig({ theme: "acme.broadcast" });
	expect(seen).toEqual(["acme.broadcast"]);
});

test("a null publisher makes updates silent no-ops (still persisted)", () => {
	setSettingsPublisher(null);
	expect(() => updateConfig({ theme: "acme.silent" })).not.toThrow();
	expect(existsSync(join(dataDir, "config.json"))).toBe(true);
});

test("loadConfig degrades a partial/corrupt file over DEFAULT_CONFIG", () => {
	writeFileSync(join(dataDir, "config.json"), "{ not json");
	resetConfigCache();
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});
