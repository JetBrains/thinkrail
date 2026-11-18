import { describe, expect, test } from "bun:test";
import type { NativeShortcutsBridge } from "@thinkrail/contracts";
import { closesSettings } from "./chordActions";
import { getNativeShortcutsBridge, settingsToggle } from "./useAppShortcuts";

test("getNativeShortcutsBridge accepts only the full bridge shape", () => {
	expect(getNativeShortcutsBridge(undefined)).toBeNull();
	expect(getNativeShortcutsBridge([])).toBeNull();
	expect(getNativeShortcutsBridge({ subscribeQuitHint: () => {} })).toBeNull();
	expect(
		getNativeShortcutsBridge({ subscribeQuitHint: () => {}, subscribeCommand: () => {} }),
	).toBeNull();
	const bridge: NativeShortcutsBridge = {
		subscribeQuitHint: () => () => {},
		subscribeCommand: () => () => {},
		quit: async () => {},
	};
	expect(getNativeShortcutsBridge(bridge)).toBe(bridge);
});

interface FakeLayer {
	readonly settings?: boolean;
	readonly inside: unknown[];
}

function layerDoc(layers: readonly FakeLayer[], active: unknown = null): Document {
	const elements = layers.map((layer) => ({
		layer,
		contains: (node: unknown) => node !== null && layer.inside.includes(node),
	}));
	return {
		activeElement: active,
		querySelector: (selector: string) =>
			(selector.includes("data-settings-dialog")
				? elements.find((element) => element.layer.settings)
				: elements[0]) ?? null,
		querySelectorAll: () => elements,
	} as unknown as Document;
}

describe("Mod+, toggles Settings", () => {
	const settings: FakeLayer = { settings: true, inside: [] };
	const confirm: FakeLayer = { inside: [] };

	test("it opens Settings with no modal open and closes it when Settings is the top layer", () => {
		expect(settingsToggle(layerDoc([]))).toBe("open");
		expect(settingsToggle(layerDoc([settings]))).toBe("close");
	});

	test("it yields to any other modal, a dialog nested in Settings included", () => {
		expect(settingsToggle(layerDoc([confirm]))).toBeNull();
		expect(settingsToggle(layerDoc([settings, confirm]))).toBeNull();
	});
});

describe("Mod+W in Settings", () => {
	const field = { name: "chat line width" };
	const popoverItem = { name: "model option" };
	const settings: FakeLayer = { settings: true, inside: [field, popoverItem] };
	const popover: FakeLayer = { inside: [popoverItem] };
	const confirm: FakeLayer = { inside: [{ name: "Delete" }] };

	test("it closes Settings at once from anywhere in it, a popover it holds included", () => {
		expect(closesSettings(layerDoc([settings], field))).toBe(true);
		expect(closesSettings(layerDoc([settings]))).toBe(true);
		expect(closesSettings(layerDoc([settings, popover], popoverItem))).toBe(true);
	});

	test("without Settings, or with a modal above it holding focus, the top layer closes as before", () => {
		expect(closesSettings(layerDoc([]))).toBe(false);
		expect(closesSettings(layerDoc([confirm]))).toBe(false);
		expect(closesSettings(layerDoc([settings, confirm], confirm.inside[0]))).toBe(false);
	});
});
