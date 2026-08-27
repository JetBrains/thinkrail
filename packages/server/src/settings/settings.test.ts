import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type LayoutPreset } from "@thinkrail/contracts";
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

test("loadConfig lifts the old custom preset catalog and discards host-wide layout preferences", () => {
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
		customLayoutPresets: [preset()],
	});
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

test("stored custom presets are isolated and capped during normalization", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({
			...DEFAULT_CONFIG,
			customLayoutPresets: [preset("valid"), { id: "broken" }],
		}),
	);
	resetConfigCache();
	expect(getConfig().customLayoutPresets).toEqual([preset("valid")]);
});
