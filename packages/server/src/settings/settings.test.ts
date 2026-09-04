import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	type AppConfigUpdate,
	DEFAULT_CONFIG,
	type LayoutPreset,
} from "@thinkrail/contracts";
import { validateCustomLayoutPresets } from "./layoutPresets";
import { getConfig, resetConfigCache, setSettingsPublisher, updateConfig } from "./settings";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function preset(id = "custom"): LayoutPreset {
	return {
		id,
		name: id,
		center: { kind: "group", id: `${id}-center` },
		left: {
			visible: true,
			width: 0.2,
			groups: [{ id: `${id}-left`, weight: 1, folded: false, tools: [] }],
		},
		right: { visible: false, width: 0.2, groups: [] },
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [{ id: `${id}-bottom`, weight: 1, folded: false, tools: [] }],
		},
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-settings-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
});

afterEach(() => {
	setSettingsPublisher(null);
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
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.theme).toBe(opaqueTheme);
	expect(getConfig().theme).toBe(opaqueTheme);
});

test("legacy theme config defaults to fixed mode without a system pair", () => {
	writeFileSync(join(dataDir, "config.json"), JSON.stringify({ theme: "light" }));
	resetConfigCache();
	const config = getConfig();
	expect(config.theme).toBe("light");
	expect(config.themeMode).toBe("fixed");
	expect(config.systemThemePair).toBeUndefined();
});

test("stored theme mode and pair normalize without interpreting opaque ids", () => {
	const pair = { light: "acme.light", dark: "acme.dark" };
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, themeMode: "system", systemThemePair: pair }),
	);
	resetConfigCache();
	expect(getConfig()).toMatchObject({ themeMode: "system", systemThemePair: pair });

	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, themeMode: "system", systemThemePair: { light: 1 } }),
	);
	resetConfigCache();
	const malformed = getConfig();
	expect(malformed.themeMode).toBe("fixed");
	expect(malformed.systemThemePair).toBeUndefined();

	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, themeMode: "future", systemThemePair: pair }),
	);
	resetConfigCache();
	const dormant = getConfig();
	expect(dormant.themeMode).toBe("fixed");
	expect(dormant.systemThemePair).toEqual(pair);
});

test("system mode requires a complete pair and replaces it atomically", () => {
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	expect(() => updateConfig({ themeMode: "system" })).toThrow(
		"system theme mode requires a complete pair",
	);
	expect(published).toEqual([]);
	expect(existsSync(join(dataDir, "config.json"))).toBe(false);

	const first = { light: "first.light", dark: "first.dark" };
	const second = { light: "second.light", dark: "second.dark" };
	expect(updateConfig({ themeMode: "system", systemThemePair: first })).toMatchObject({
		themeMode: "system",
		systemThemePair: first,
	});
	expect(updateConfig({ systemThemePair: second }).systemThemePair).toEqual(second);
});

test("invalid theme updates are rejected and a legacy theme choice exits system mode", () => {
	const pair = { light: "light", dark: "dark" };
	updateConfig({ themeMode: "system", systemThemePair: pair });
	const before = getConfig();
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));

	expect(() => updateConfig({ themeMode: "automatic" } as unknown as AppConfigUpdate)).toThrow(
		"themeMode must be fixed or system",
	);
	expect(() =>
		updateConfig({ systemThemePair: { light: "light" } } as unknown as AppConfigUpdate),
	).toThrow("systemThemePair must contain light and dark theme ids");
	expect(getConfig()).toEqual(before);
	expect(published).toEqual([]);

	const fixed = updateConfig({ theme: "acme.fixed" });
	expect(fixed.theme).toBe("acme.fixed");
	expect(fixed.themeMode).toBe("fixed");
	expect(fixed.systemThemePair).toEqual(pair);
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

test("an older host preserves unknown top-level config extensions when updating a known field", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, futureSetting: { mode: "new" } }),
	);
	resetConfigCache();
	updateConfig({ theme: "acme.changed" });
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.futureSetting).toEqual({ mode: "new" });
});

test("loadConfig replaces an invalid composer growth preset with the default", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, composerGrowthLimit: "enormous" }),
	);
	resetConfigCache();
	expect(getConfig()).toHaveProperty("composerGrowthLimit", "half-chat");
});

test("retired chat message order is stripped from disk and stale updates", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, chatMessageOrder: "newest-first" }),
	);
	resetConfigCache();
	expect(getConfig()).not.toHaveProperty("chatMessageOrder");

	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	const staleUpdate = { chatMessageOrder: "newest-first" } as AppConfigUpdate;
	const next = updateConfig(staleUpdate);
	expect(next).not.toHaveProperty("chatMessageOrder");
	expect(published).toHaveLength(1);
	expect(published[0]).not.toHaveProperty("chatMessageOrder");
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk).not.toHaveProperty("chatMessageOrder");
});

test("reviewAutoFix defaults on; an old config without it loads the default; toggling off round-trips", () => {
	expect(DEFAULT_CONFIG.reviewAutoFix).toBe(true);
	writeFileSync(join(dataDir, "config.json"), JSON.stringify({ theme: "dark" }));
	resetConfigCache();
	expect(getConfig().reviewAutoFix).toBe(true);
	const next = updateConfig({ reviewAutoFix: false });
	expect(next.reviewAutoFix).toBe(false);
	resetConfigCache();
	expect(getConfig().reviewAutoFix).toBe(false);
});

test("subagents default on; an old config inherits that default; toggling off round-trips", () => {
	expect(DEFAULT_CONFIG.subagentsEnabled).toBe(true);
	writeFileSync(join(dataDir, "config.json"), JSON.stringify({ theme: "dark" }));
	resetConfigCache();
	expect(getConfig().subagentsEnabled).toBe(true);
	const next = updateConfig({ subagentsEnabled: false });
	expect(next.subagentsEnabled).toBe(false);
	resetConfigCache();
	expect(getConfig().subagentsEnabled).toBe(false);
});

test("JetBrains quota preferences default, persist, and survive an old partial config", () => {
	expect(DEFAULT_CONFIG.jbcentralQuotaEnabled).toBe(true);
	expect(DEFAULT_CONFIG.jbcentralQuotaRefreshSeconds).toBe(30);
	writeFileSync(join(dataDir, "config.json"), JSON.stringify({ theme: "dark" }));
	resetConfigCache();
	expect(getConfig()).toMatchObject({
		jbcentralQuotaEnabled: true,
		jbcentralQuotaRefreshSeconds: 30,
	});

	const next = updateConfig({
		jbcentralQuotaEnabled: false,
		jbcentralQuotaRefreshSeconds: 1,
	});
	expect(next).toMatchObject({
		jbcentralQuotaEnabled: false,
		jbcentralQuotaRefreshSeconds: 1,
	});
	resetConfigCache();
	expect(getConfig()).toMatchObject({
		jbcentralQuotaEnabled: false,
		jbcentralQuotaRefreshSeconds: 1,
	});
});

test("stored invalid JetBrains quota preferences fall back fieldwise", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({
			...DEFAULT_CONFIG,
			jbcentralQuotaEnabled: "yes",
			jbcentralQuotaRefreshSeconds: 0,
		}),
	);
	resetConfigCache();
	expect(getConfig()).toMatchObject({
		jbcentralQuotaEnabled: true,
		jbcentralQuotaRefreshSeconds: 30,
	});
});

test("invalid JetBrains quota updates are rejected before persistence or broadcast", () => {
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	const before = getConfig();
	for (const update of [
		{ jbcentralQuotaEnabled: "true" },
		{ jbcentralQuotaRefreshSeconds: 0 },
		{ jbcentralQuotaRefreshSeconds: 3601 },
		{ jbcentralQuotaRefreshSeconds: 1.5 },
		{ jbcentralQuotaRefreshSeconds: "30" },
	]) {
		expect(() => updateConfig(update as unknown as AppConfigUpdate)).toThrow();
		expect(getConfig()).toEqual(before);
	}
	expect(published).toEqual([]);
	expect(existsSync(join(dataDir, "config.json"))).toBe(false);
});

test("line-width fields default independently when an older or malformed config is loaded", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({
			...DEFAULT_CONFIG,
			chatLineWidth: 39,
			fileLineWidth: 180,
			chatLineWidthBounded: "yes",
			fileLineWidthBounded: false,
		}),
	);
	resetConfigCache();

	expect(getConfig()).toMatchObject({
		chatLineWidth: 120,
		fileLineWidth: 180,
		chatLineWidthBounded: true,
		fileLineWidthBounded: false,
	});
});

test("invalid line-width updates are rejected before persistence or broadcast", () => {
	const invalidUpdates = [
		{ chatLineWidth: 39 },
		{ fileLineWidth: 241 },
		{ chatLineWidth: 80.5 },
		{ fileLineWidth: Number.POSITIVE_INFINITY },
		{ chatLineWidthBounded: "true" },
		{ fileLineWidthBounded: 1 },
	];

	for (const update of invalidUpdates) {
		rmSync(join(dataDir, "config.json"), { force: true });
		resetConfigCache();
		const published: AppConfig[] = [];
		setSettingsPublisher((config) => published.push(config));
		const before = getConfig();

		expect(() => updateConfig(update as unknown as AppConfigUpdate)).toThrow();
		expect(getConfig()).toEqual(before);
		expect(published).toEqual([]);
		expect(existsSync(join(dataDir, "config.json"))).toBe(false);
	}
});

test("a non-boolean subagents update is rejected before persistence or broadcast", () => {
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	const before = getConfig();
	const invalid = { subagentsEnabled: "false" } as unknown as AppConfigUpdate;

	expect(() => updateConfig(invalid)).toThrow("subagentsEnabled must be a boolean");
	expect(getConfig()).toEqual(before);
	expect(published).toEqual([]);
	expect(existsSync(join(dataDir, "config.json"))).toBe(false);
});

test("a failed config write leaves the live cache and publisher unchanged", () => {
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	expect(getConfig().subagentsEnabled).toBe(true);
	mkdirSync(join(dataDir, "config.json"));

	expect(() => updateConfig({ subagentsEnabled: false })).toThrow();
	expect(getConfig().subagentsEnabled).toBe(true);
	expect(published).toEqual([]);
});

test("reviewModel/reviewEffort persist through the top-level partial merge", () => {
	const model = {
		id: "m",
		name: "M",
		provider: "p",
		contextWindow: 1,
		reasoning: false,
		thinkingLevels: [],
	};
	updateConfig({ reviewModel: model, reviewEffort: "high" });
	resetConfigCache();
	expect(getConfig().reviewModel).toEqual(model);
	expect(getConfig().reviewEffort).toBe("high");
});

test("a null reviewModel/reviewEffort clears the override back to unset, and it stays cleared on disk", () => {
	const model = {
		id: "m",
		name: "M",
		provider: "p",
		contextWindow: 1,
		reasoning: false,
		thinkingLevels: [],
	};
	updateConfig({ reviewModel: model, reviewEffort: "high" });
	const next = updateConfig({ reviewModel: null, reviewEffort: null });
	expect("reviewModel" in next).toBe(false);
	expect("reviewEffort" in next).toBe(false);
	resetConfigCache();
	expect(getConfig().reviewModel).toBeUndefined();
	expect(getConfig().reviewEffort).toBeUndefined();
});

test("loadConfig ignores the old layout settings object", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({
			theme: "acme.persisted",
			layout: {
				defaultPresetId: "review",
				customPresets: [preset()],
				maxSideGroups: 12,
				maxBottomGroups: 9,
			},
		}),
	);
	resetConfigCache();
	expect(getConfig()).toEqual({
		...DEFAULT_CONFIG,
		theme: "acme.persisted",
	});
});

test("updateConfig ignores the old layout settings object from an untrusted client", () => {
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	const update = {
		theme: "acme.updated",
		layout: {
			defaultPresetId: "review",
			customPresets: [preset()],
			maxSideGroups: 12,
			maxBottomGroups: 9,
		},
	};

	const next = updateConfig(update);
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));

	expect(next.theme).toBe("acme.updated");
	expect("layout" in next).toBe(false);
	expect(published).toEqual([next]);
	expect(onDisk).not.toHaveProperty("layout");
});

test("custom preset updates validate the complete catalog and permit empty structural slots", () => {
	expect(updateConfig({ customLayoutPresets: [preset()] }).customLayoutPresets).toEqual([preset()]);
	expect(() =>
		updateConfig({
			customLayoutPresets: [{ ...preset(), right: { visible: true, width: 0.2, groups: [] } }],
		}),
	).toThrow("cannot be visible while empty");
	expect(() => validateCustomLayoutPresets([preset("same"), preset("same")])).toThrow(
		"ids must be unique",
	);
});

test("stored custom presets keep only complete current-schema entries", () => {
	const { bottom: _bottom, ...bottomless } = preset("bottomless");
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({
			...DEFAULT_CONFIG,
			customLayoutPresets: [preset("valid"), bottomless, { id: "broken" }],
		}),
	);
	resetConfigCache();
	expect(getConfig().customLayoutPresets).toEqual([preset("valid")]);
});
