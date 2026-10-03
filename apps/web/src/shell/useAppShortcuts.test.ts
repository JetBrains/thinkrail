import { expect, test } from "bun:test";
import type { NativeShortcutsBridge } from "@thinkrail/contracts";
import { getNativeShortcutsBridge } from "./useAppShortcuts";

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
