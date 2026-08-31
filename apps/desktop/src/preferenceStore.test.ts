import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	injectInitialDesktopPreferences,
	MAX_DESKTOP_PREFERENCE_KEY_LENGTH,
	MAX_DESKTOP_PREFERENCE_VALUE_LENGTH,
	readDesktopPreferenceRemove,
	readDesktopPreferenceWrite,
} from "./preferenceAdapter";
import { PreferenceStore } from "./preferenceStore";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function preferencePath(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-preferences-"));
	roots.push(root);
	mkdirSync(join(root, "nested"));
	return join(root, "nested", "preferences.json");
}

test("persists preferences independently by backend profile and window", () => {
	const path = preferencePath();
	const preferences = new PreferenceStore(path);
	expect(preferences.read("local", "main")).toEqual({});
	expect(preferences.write("local", "main", "chat-message-order", "newest-first")).toBe(true);
	expect(preferences.write("local", "secondary", "chat-message-order", "oldest-first")).toBe(true);
	expect(preferences.write("remote:one", "main", "density", "compact")).toBe(true);

	const restored = new PreferenceStore(path);
	expect(restored.read("local", "main")).toEqual({
		"chat-message-order": "newest-first",
	});
	expect(restored.read("local", "secondary")).toEqual({
		"chat-message-order": "oldest-first",
	});
	expect(restored.read("remote:one", "main")).toEqual({ density: "compact" });
});

test("persists removals without disturbing sibling preferences", () => {
	const path = preferencePath();
	const preferences = new PreferenceStore(path);
	preferences.write("local", "main", "chat-message-order", "newest-first");
	preferences.write("local", "main", "density", "compact");
	expect(preferences.remove("local", "main", "chat-message-order")).toBe(true);
	expect(preferences.remove("local", "main", "missing")).toBe(true);

	expect(new PreferenceStore(path).read("local", "main")).toEqual({ density: "compact" });
});

test("rejects unbounded or control-bearing keys and values", () => {
	const path = preferencePath();
	const preferences = new PreferenceStore(path);
	expect(
		preferences.write("local", "main", "k".repeat(MAX_DESKTOP_PREFERENCE_KEY_LENGTH + 1), "value"),
	).toBe(false);
	expect(
		preferences.write(
			"local",
			"main",
			"bounded",
			"v".repeat(MAX_DESKTOP_PREFERENCE_VALUE_LENGTH + 1),
		),
	).toBe(false);
	expect(preferences.write("local", "main", "bad\nkey", "value")).toBe(false);
	expect(preferences.write("local", "main", "", "value")).toBe(false);
	expect(existsSync(path)).toBe(false);
});

test("falls back from corrupt, oversized, and unsupported documents", () => {
	const path = preferencePath();
	writeFileSync(path, "not-json");
	expect(new PreferenceStore(path).read("local", "main")).toEqual({});
	writeFileSync(
		path,
		JSON.stringify({
			version: 2,
			preferences: { "local:main": { "chat-message-order": "newest-first" } },
		}),
	);
	expect(new PreferenceStore(path).read("local", "main")).toEqual({});
	writeFileSync(path, "x".repeat(1024 * 1024 + 1));
	expect(new PreferenceStore(path).read("local", "main")).toEqual({});
});

test("idempotent writes preserve the stored document", () => {
	const path = preferencePath();
	const preferences = new PreferenceStore(path);
	preferences.write("local", "main", "chat-message-order", "newest-first");
	const first = readFileSync(path, "utf8");
	preferences.write("local", "main", "chat-message-order", "newest-first");
	expect(readFileSync(path, "utf8")).toBe(first);
});

test("filesystem failures reject a write without changing the in-memory document", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-preferences-blocked-"));
	roots.push(root);
	const blocker = join(root, "blocker");
	writeFileSync(blocker, "not a directory");
	const preferences = new PreferenceStore(join(blocker, "preferences.json"));
	expect(preferences.write("local", "main", "chat-message-order", "newest-first")).toBe(false);
	expect(preferences.read("local", "main")).toEqual({});
});

test("RPC preference payloads are narrowed before handlers read them", () => {
	expect(readDesktopPreferenceWrite({ key: "density", value: "compact" })).toEqual({
		key: "density",
		value: "compact",
	});
	expect(readDesktopPreferenceRemove({ key: "density" })).toEqual({ key: "density" });
	for (const malformed of [null, [], "density", { key: "density" }, { key: 1, value: "compact" }]) {
		expect(readDesktopPreferenceWrite(malformed)).toBeNull();
	}
	for (const malformed of [null, [], "density", { key: 1 }]) {
		expect(readDesktopPreferenceRemove(malformed)).toBeNull();
	}
});

test("preload injection installs initial values before the bundled source", () => {
	const preload = injectInitialDesktopPreferences("globalThis.preloadStarted = true;", {
		"chat-message-order": "newest-first\u2028<next>",
	});
	expect(preload.indexOf(INITIAL_DESKTOP_PREFERENCES_GLOBAL)).toBeGreaterThanOrEqual(0);
	expect(preload.indexOf(INITIAL_DESKTOP_PREFERENCES_GLOBAL)).toBeLessThan(
		preload.indexOf("globalThis.preloadStarted"),
	);
	expect(preload).not.toContain("\u2028");
	expect(preload).not.toContain("<next>");
});
