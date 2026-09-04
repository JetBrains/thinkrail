import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	buildThemeCatalog,
	deriveSystemThemePair,
	installThemeCatalog,
	onSystemAppearanceChange,
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
	let stored: string | null = "light";
	Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
		getItem: () => stored,
		setItem: (_key: string, value: string) => {
			stored = value;
		},
		removeItem: () => {
			stored = null;
		},
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
		stored = JSON.stringify({ version: 1, theme: "dark", themeMode: "system" });
		expect(readThemeHint()).toEqual({ theme: "dark", themeMode: "fixed" });
	} finally {
		Reflect.deleteProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
	}
});
