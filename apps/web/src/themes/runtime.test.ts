import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	buildThemeCatalog,
	clearUserThemes,
	deriveSystemThemePair,
	getThemes,
	getUserThemeIssues,
	installCachedUserThemes,
	installThemeCatalog,
	installUserThemes,
	onSystemAppearanceChange,
	onThemesChange,
	readSystemAppearance,
	readThemeHint,
	resolveThemePreference,
	type ThemePreference,
	writeThemeHint,
} from "./runtime";

function bundledCandidates(): Record<string, unknown> {
	const dir = join(import.meta.dir, "bundled");
	return Object.fromEntries(
		readdirSync(dir)
			.filter((file) => file.endsWith(".theme.json"))
			.map((file) => [file, JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown]),
	);
}

test("the bundled catalog is indexed and sorted default-first, then by order", () => {
	const catalog = buildThemeCatalog(bundledCandidates());
	expect(catalog.list.length).toBeGreaterThan(1);
	expect(catalog.list[0]?.id).toBe(DEFAULT_CONFIG.theme);
	const orders = catalog.list.slice(1).map((theme) => theme.order);
	expect(orders).toEqual([...orders].sort((a, b) => a - b));
	for (const entry of catalog.list) expect(catalog.byId.get(entry.id)?.label).toBe(entry.label);
});

test("a duplicate id, an invalid manifest, or a missing appearance fails the build loudly", () => {
	const candidates = bundledCandidates();
	const first = Object.values(candidates)[0];
	expect(() =>
		buildThemeCatalog({ ...candidates, "zz-copy.theme.json": structuredClone(first) }),
	).toThrow("Duplicate bundled theme id");
	expect(() => buildThemeCatalog({ "broken.theme.json": { schemaVersion: 1 } })).toThrow(
		"Invalid bundled theme broken.theme.json",
	);
	const withoutDefault = Object.fromEntries(
		Object.entries(candidates).filter(
			([, value]) => (value as { id?: string }).id !== DEFAULT_CONFIG.theme,
		),
	);
	expect(() => buildThemeCatalog(withoutDefault)).toThrow("default theme is missing");
	const withoutLight = Object.fromEntries(
		Object.entries(candidates).filter(
			([, value]) => (value as { appearance?: string }).appearance !== "light",
		),
	);
	expect(() => buildThemeCatalog(withoutLight)).toThrow("light and dark");
});

test("system pair derivation follows the fixed theme contrast", () => {
	installThemeCatalog(buildThemeCatalog(bundledCandidates()));
	expect(deriveSystemThemePair("dark")).toEqual({ light: "light", dark: "dark" });
	expect(deriveSystemThemePair("high-contrast-light")).toEqual({
		light: "high-contrast-light",
		dark: "high-contrast-dark",
	});
});

test("system resolution enforces appearance and preserves unavailable ids", () => {
	installThemeCatalog(buildThemeCatalog(bundledCandidates()));
	const preference: ThemePreference = {
		theme: "high-contrast-dark",
		themeMode: "system",
		systemThemePair: { light: "high-contrast-dark", dark: "unavailable-dark" },
	};
	expect(resolveThemePreference(preference, "light")).toMatchObject({
		requestedId: "high-contrast-dark",
		theme: { id: "light", appearance: "light" },
		fallback: true,
		systemAppearance: "light",
	});
	expect(resolveThemePreference(preference, "dark")).toMatchObject({
		requestedId: "unavailable-dark",
		theme: { id: "dark", appearance: "dark" },
		fallback: true,
		systemAppearance: "dark",
	});
});

test("system appearance observation defaults light and cleans up its listener", () => {
	Reflect.deleteProperty(globalThis, "matchMedia");
	expect(readSystemAppearance()).toBe("light");
	let mediaListener: ((event: { matches: boolean }) => void) | undefined;
	let removed = false;
	Reflect.set(globalThis, "matchMedia", (query: string) => ({
		matches: query.includes("dark"),
		addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) => {
			mediaListener = listener;
		},
		removeEventListener: () => {
			removed = true;
		},
	}));
	try {
		expect(readSystemAppearance()).toBe("dark");
		const seen: string[] = [];
		const dispose = onSystemAppearanceChange((appearance) => seen.push(appearance));
		mediaListener?.({ matches: false });
		expect(seen).toEqual(["light"]);
		dispose();
		expect(removed).toBe(true);
	} finally {
		Reflect.deleteProperty(globalThis, "matchMedia");
	}
});

test("theme hints migrate legacy ids and use the native stable adapter", () => {
	const HINT_KEY = "thinkrail-theme";
	const stored = new Map<string, string>([[HINT_KEY, "light"]]);
	Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
	});
	try {
		expect(readThemeHint()).toEqual({ theme: "light", themeMode: "fixed" });
		const preference: ThemePreference = {
			theme: "dark",
			themeMode: "system",
			systemThemePair: { light: "high-contrast-light", dark: "high-contrast-dark" },
		};
		writeThemeHint(preference);
		expect(readThemeHint()).toEqual(preference);
		stored.set(HINT_KEY, JSON.stringify({ version: 1, theme: "dark", themeMode: "system" }));
		expect(readThemeHint()).toEqual({ theme: "dark", themeMode: "fixed" });
	} finally {
		Reflect.deleteProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
	}
});

function userTheme(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const dark = bundledCandidates()["dark.theme.json"] as Record<string, unknown>;
	return { ...structuredClone(dark), id, label: id, ...overrides };
}

test("user themes join the catalog; invalid, reserved and duplicate files become issues", () => {
	installThemeCatalog(buildThemeCatalog(bundledCandidates()));
	let notified = 0;
	const stop = onThemesChange(() => notified++);
	try {
		installUserThemes([
			{ fileName: "ocean.theme.json", ok: true, manifest: userTheme("ocean", { order: 1 }) },
			{ fileName: "copy.theme.json", ok: true, manifest: userTheme("ocean") },
			{ fileName: "dark.theme.json", ok: true, manifest: userTheme("dark") },
			{ fileName: "legacy.theme.json", ok: true, manifest: userTheme("high-contrast") },
			{ fileName: "partial.theme.json", ok: true, manifest: { schemaVersion: 2 } },
			{ fileName: "broken.theme.json", ok: false, error: "invalid-json", detail: "bad" },
		]);
		expect(notified).toBe(1);
		expect(getThemes().map((theme) => theme.id)).toContain("ocean");
		expect(getThemes()[0]?.id).toBe(DEFAULT_CONFIG.theme);
		expect(resolveThemePreference({ theme: "ocean", themeMode: "fixed" }).fallback).toBe(false);
		expect(getUserThemeIssues().map((issue) => [issue.fileName, issue.error])).toEqual([
			["copy.theme.json", "duplicate-id"],
			["dark.theme.json", "reserved-id"],
			["legacy.theme.json", "reserved-id"],
			["partial.theme.json", "invalid-theme"],
			["broken.theme.json", "invalid-json"],
		]);
		installUserThemes([]);
		expect(getThemes().map((theme) => theme.id)).not.toContain("ocean");
		expect(getUserThemeIssues()).toEqual([]);
	} finally {
		stop();
	}
});

test("only the user themes the hint needs are cached and reinstalled before the host answers", () => {
	const stored = new Map<string, string>();
	Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
	});
	try {
		installThemeCatalog(buildThemeCatalog(bundledCandidates()));
		installUserThemes([
			{ fileName: "ocean.theme.json", ok: true, manifest: userTheme("ocean") },
			{ fileName: "forest.theme.json", ok: true, manifest: userTheme("forest") },
		]);
		writeThemeHint({
			theme: "ocean",
			themeMode: "system",
			systemThemePair: { light: "light", dark: "ocean" },
		});
		installThemeCatalog(buildThemeCatalog(bundledCandidates()));
		expect(getThemes().map((theme) => theme.id)).not.toContain("ocean");
		installCachedUserThemes();
		const ids = getThemes().map((theme) => theme.id);
		expect(ids).toContain("ocean");
		expect(ids).not.toContain("forest");
		expect(getUserThemeIssues()).toEqual([]);
		writeThemeHint({ theme: "dark", themeMode: "fixed" });
		expect(stored.has("thinkrail-user-themes")).toBe(false);
	} finally {
		Reflect.deleteProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
	}
});

test("a user theme id shaped like an object prototype key stays an ordinary id", () => {
	installThemeCatalog(buildThemeCatalog(bundledCandidates()));
	installUserThemes([
		{ fileName: "constructor.theme.json", ok: true, manifest: userTheme("constructor") },
	]);
	expect(getUserThemeIssues()).toEqual([]);
	expect(resolveThemePreference({ theme: "constructor", themeMode: "fixed" })).toMatchObject({
		theme: { id: "constructor" },
		fallback: false,
	});
});

test("an unsupported host clears user themes, and an oversized cache is dropped, not written", () => {
	const stored = new Map<string, string>();
	Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
	});
	try {
		installThemeCatalog(buildThemeCatalog(bundledCandidates()));
		installUserThemes([
			{
				fileName: "huge.theme.json",
				ok: true,
				manifest: userTheme("huge", { label: "x".repeat(70_000) }),
			},
		]);
		writeThemeHint({ theme: "huge", themeMode: "fixed" });
		expect(stored.has("thinkrail-user-themes")).toBe(false);
		expect(getThemes().map((theme) => theme.id)).toContain("huge");
		clearUserThemes();
		expect(getThemes().map((theme) => theme.id)).not.toContain("huge");
		expect(resolveThemePreference({ theme: "huge", themeMode: "fixed" }).fallback).toBe(true);
	} finally {
		Reflect.deleteProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
	}
});
