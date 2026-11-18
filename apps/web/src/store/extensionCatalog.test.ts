import { beforeEach, describe, expect, test } from "bun:test";
import { type ExtensionCatalogEntry, PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import {
	selectBuiltinExtensions,
	selectInstalledExtensions,
	selectInstalledWebHalves,
	selectSupportsExtensionBrowse,
	selectSupportsInstalledExtensions,
} from "./selectors";

const BUILTIN: ExtensionCatalogEntry = {
	name: "visualize",
	title: "Visualize",
	enabled: true,
	tools: ["visualize"],
	hasChildExtensions: false,
	kind: "builtin",
};
const PALETTE: ExtensionCatalogEntry = {
	name: "@thinkrail/example-extension-palette",
	title: "Palette",
	enabled: false,
	tools: ["color_palette"],
	hasChildExtensions: false,
	kind: "installed",
	source: "/tmp/palette",
	state: "loaded",
	web: {
		url: "/extensions/x/0.0.0-abc/dist/web.js",
		styles: "/extensions/x/0.0.0-abc/dist/web.css",
	},
};
const FAILED: ExtensionCatalogEntry = {
	name: "broken",
	title: "broken",
	enabled: true,
	tools: [],
	hasChildExtensions: false,
	kind: "installed",
	source: "/tmp/broken",
	state: "failed",
	error: "boom",
};
const UI_ONLY: ExtensionCatalogEntry = {
	...PALETTE,
	name: "cards",
	enabled: true,
	web: { url: "/extensions/cards/1.0.0-def/web.js" },
};

describe("extension catalog selectors", () => {
	test("split the host's list into built-in and installed rows, keeping host order", () => {
		const catalog = [BUILTIN, PALETTE, FAILED];
		expect(selectBuiltinExtensions(catalog)).toEqual([BUILTIN]);
		expect(selectInstalledExtensions(catalog)).toEqual([PALETTE, FAILED]);
		expect(selectBuiltinExtensions("loading")).toBe("loading");
		expect(selectInstalledExtensions("failed")).toEqual([]);
		const { kind: _kind, ...older } = BUILTIN;
		expect(selectBuiltinExtensions([older])).toEqual([older]);
	});

	test("web halves include switched-off extensions and are unknown until the list is in", () => {
		const state = {
			protocolVersion: PROTOCOL_VERSION,
			extensionCatalog: [BUILTIN, PALETTE, FAILED, UI_ONLY],
		};
		expect(selectInstalledWebHalves(state)).toEqual([
			{ name: PALETTE.name, url: PALETTE.web?.url ?? "", styles: PALETTE.web?.styles ?? "" },
			{ name: "cards", url: "/extensions/cards/1.0.0-def/web.js" },
		]);
		expect(selectInstalledWebHalves({ ...state, extensionCatalog: "loading" })).toBeNull();
		expect(selectInstalledWebHalves({ ...state, protocolVersion: null })).toBeNull();
		expect(selectInstalledWebHalves({ ...state, protocolVersion: 125 })).toEqual([]);
	});

	test("the installed and Browse features are gated by their protocol versions", () => {
		expect(selectSupportsInstalledExtensions({ protocolVersion: 125 })).toBe(false);
		expect(selectSupportsInstalledExtensions({ protocolVersion: 126 })).toBe(true);
		expect(selectSupportsExtensionBrowse({ protocolVersion: 126 })).toBe(false);
		expect(selectSupportsExtensionBrowse({ protocolVersion: 127 })).toBe(true);
		expect(selectSupportsExtensionBrowse({ protocolVersion: null })).toBe(false);
	});
});

describe("extension catalog state", () => {
	beforeEach(() => {
		useAppStore.setState({ extensionCatalog: "loading", welcomeProtocolVersion: null });
	});

	test("a welcome from a host of another version forgets the previous host's list", () => {
		const store = useAppStore.getState();
		store.installWelcomeSnapshot(PROTOCOL_VERSION, [], []);
		useAppStore.getState().installExtensionCatalog([BUILTIN, PALETTE]);
		useAppStore.getState().installWelcomeSnapshot(PROTOCOL_VERSION, [], []);
		expect(useAppStore.getState().extensionCatalog).toEqual([BUILTIN, PALETTE]);
		useAppStore.getState().installWelcomeSnapshot(124, [], []);
		expect(useAppStore.getState().extensionCatalog).toBe("loading");
	});
});
