import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { getConfig, setSettingsPublisher, updateConfig } from "./settings";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-settings-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	setSettingsPublisher(null); // never leak a test's publisher into the next
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
	// A re-read reflects it (from disk — reads are per-request).
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
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});

test("getConfig reads per-request: an out-of-band config.json write is visible immediately", () => {
	expect(getConfig().theme).toBe("dark");
	writeFileSync(join(dataDir, "config.json"), JSON.stringify({ theme: "acme.seeded" }));
	expect(getConfig().theme).toBe("acme.seeded"); // no cache to shadow the file (the e2e isolation doctrine)
});
