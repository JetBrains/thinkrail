import { beforeEach, expect, test } from "bun:test";
import type { ExtensionInfo, ExtensionTheme } from "@thinkrail/contracts";
import { useExtStore } from "./extStore";
import { effectiveTheme, findTheme, selectThemes } from "./extThemes";

const WARM: ExtensionTheme = {
	id: "warm",
	title: "Warm",
	mode: "light",
	tokens: { "--background": "#fbf5ec" },
	css: true,
};

const info = (name: string, overrides: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
	name,
	title: name.toUpperCase(),
	scope: "user",
	status: "active",
	generation: 1,
	build: "0123456789abcdef",
	permissions: [],
	surfaces: [],
	themes: [WARM],
	...overrides,
});

const PREVIEW = { mode: "dark" as const, tokens: { "--accent": "#ff0000" } };

beforeEach(() => {
	useExtStore.setState({
		hydration: "ready",
		extensions: {},
		channels: {},
		params: {},
		themeSelection: null,
		themePreview: null,
	});
});

test("themes list only extensions with a build, keyed name/id", () => {
	const extensions = {
		b: info("b"),
		a: info("a"),
		off: info("off", { status: "blocked", build: null, projectId: "p" }),
		broken: info("broken", { status: "error", build: null }),
	};
	expect(selectThemes(extensions).map((placed) => placed.key)).toEqual(["a/warm", "b/warm"]);
	expect(findTheme(extensions, "a/warm")?.theme.title).toBe("Warm");
	expect(findTheme(extensions, "off/warm")).toBeUndefined();
	expect(findTheme(extensions, null)).toBeUndefined();
});

test("a preview wins over the selection, and a selection carries its css path", () => {
	const extensions = { a: info("a") };
	const base = { hydration: "ready" as const, extensions, themeSelection: "a/warm" };
	expect(effectiveTheme({ ...base, themePreview: null })).toEqual({
		source: "selection",
		overlay: { key: "a/warm", mode: "light", tokens: { "--background": "#fbf5ec" } },
		css: "/ext/a/0123456789abcdef/warm.theme.css",
	});
	expect(effectiveTheme({ ...base, themePreview: { name: "a", overlay: PREVIEW } })).toEqual({
		source: "preview",
		overlay: { key: "preview:a", ...PREVIEW },
		css: null,
	});
	expect(effectiveTheme({ ...base, themeSelection: "gone/warm", themePreview: null })).toBeNull();
});

test("a preview ends when its extension reloads or unloads, not on another's change", () => {
	const store = useExtStore.getState();
	store.install([info("a"), info("b")], {});
	store.setThemePreview({ name: "a", overlay: PREVIEW });
	store.applyChanged(info("b", { generation: 5 }));
	expect(useExtStore.getState().themePreview?.name).toBe("a");
	store.applyChanged(info("a", { generation: 2 }));
	expect(useExtStore.getState().themePreview).toBeNull();

	store.setThemePreview({ name: "b", overlay: PREVIEW });
	store.applyRemoved({ name: "b" });
	expect(useExtStore.getState().themePreview).toBeNull();
});
