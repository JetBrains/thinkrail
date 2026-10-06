import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppConfig, type AppConfigUpdate, DEFAULT_CONFIG } from "@thinkrail/contracts";
import { getConfig, resetConfigCache, setSettingsPublisher, updateConfig } from "./settings";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let published: AppConfig[] = [];

function configPath(): string {
	return join(dataDir, "config.json");
}

function expectUnchanged(before: AppConfig): void {
	expect(getConfig()).toEqual(before);
	expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual(before);
	expect(published).toEqual([]);
}

function seedConfig(): AppConfig {
	writeFileSync(configPath(), JSON.stringify(DEFAULT_CONFIG));
	resetConfigCache();
	return getConfig();
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-settings-keys-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	published = [];
	setSettingsPublisher((config) => published.push(config));
});

afterEach(() => {
	setSettingsPublisher(null);
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("an unknown update key rejects the whole update before persist or publish", () => {
	const before = seedConfig();
	expect(() => updateConfig({ futureSetting: true } as unknown as AppConfigUpdate)).toThrow(
		"Unknown setting: futureSetting",
	);
	expect(() =>
		updateConfig({ theme: "acme.dark", futureSetting: 1 } as unknown as AppConfigUpdate),
	).toThrow("Unknown setting: futureSetting");
	expectUnchanged(before);
});

test("a __proto__ key from JSON is rejected, and inherited names are not accepted", () => {
	const before = seedConfig();
	const update = JSON.parse('{"__proto__":{"theme":"x"}}') as AppConfigUpdate;
	expect(() => updateConfig(update)).toThrow("Unknown setting: __proto__");
	expect(() => updateConfig({ toString: "x" } as unknown as AppConfigUpdate)).toThrow(
		"Unknown setting: toString",
	);
	expectUnchanged(before);
});

test.each([
	["a string", "theme"],
	["an array", ["theme"]],
	["null", null],
	["undefined", undefined],
])("a non-object update (%s) is rejected", (_label, update) => {
	expect(() => updateConfig(update as unknown as AppConfigUpdate)).toThrow(
		"settings update must be an object",
	);
	expect(existsSync(configPath())).toBe(false);
	expect(published).toEqual([]);
});

test("an empty update is accepted", () => {
	expect(updateConfig({})).toEqual(DEFAULT_CONFIG);
	expect(published).toHaveLength(1);
});

test("a valid multi-key update persists and publishes", () => {
	const next = updateConfig({
		theme: "acme.dark",
		chatLineWidth: 100,
		reviewAutoFix: false,
		defaultEffort: "high",
		subagentsEnabled: false,
	});
	expect(next).toMatchObject({
		theme: "acme.dark",
		chatLineWidth: 100,
		reviewAutoFix: false,
		defaultEffort: "high",
		subagentsEnabled: false,
	});
	expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual(next);
	expect(published).toEqual([next]);
});
