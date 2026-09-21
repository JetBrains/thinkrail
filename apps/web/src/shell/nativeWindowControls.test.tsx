import { expect, test } from "bun:test";
import type { NativeWindowControlsBridge } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeWindowControls } from "./NativeWindowControls";
import { getNativeWindowControlsBridge } from "./useNativeWindowControls";

const FAKE_BRIDGE: NativeWindowControlsBridge = {
	getState: () => Promise.resolve({ maximized: false, fullScreen: false }),
	minimize: () => Promise.resolve(),
	toggleMaximize: () => Promise.resolve(),
	close: () => Promise.resolve(),
	subscribe: () => () => {},
};

test("getNativeWindowControlsBridge rejects anything that is not a full bridge shape", () => {
	expect(getNativeWindowControlsBridge(undefined)).toBeNull();
	expect(getNativeWindowControlsBridge(null)).toBeNull();
	expect(getNativeWindowControlsBridge([])).toBeNull();
	expect(getNativeWindowControlsBridge({})).toBeNull();
	expect(getNativeWindowControlsBridge({ minimize: true })).toBeNull();
	expect(getNativeWindowControlsBridge(FAKE_BRIDGE)).toBe(FAKE_BRIDGE);
});

test("renders three window control buttons with labels and testids, wrapped in window-no-drag", () => {
	const markup = renderToStaticMarkup(
		<NativeWindowControls
			state={{ maximized: false, fullScreen: false }}
			onMinimize={() => {}}
			onToggleMaximize={() => {}}
			onClose={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="window-controls"');
	expect(markup).toContain("window-no-drag");
	expect(markup).toContain('data-testid="window-minimize"');
	expect(markup).toContain('aria-label="Minimize"');
	expect(markup).toContain('data-testid="window-maximize"');
	expect(markup).toContain('aria-label="Maximize"');
	expect(markup).toContain('data-maximized="false"');
	expect(markup).toContain('data-testid="window-close"');
	expect(markup).toContain('aria-label="Close"');
});

test("maximized state flips the maximize button to Restore", () => {
	const markup = renderToStaticMarkup(
		<NativeWindowControls
			state={{ maximized: true, fullScreen: false }}
			onMinimize={() => {}}
			onToggleMaximize={() => {}}
			onClose={() => {}}
		/>,
	);
	expect(markup).toContain('aria-label="Restore"');
	expect(markup).toContain('data-maximized="true"');
});

test("fullScreen state renders nothing", () => {
	const markup = renderToStaticMarkup(
		<NativeWindowControls
			state={{ maximized: false, fullScreen: true }}
			onMinimize={() => {}}
			onToggleMaximize={() => {}}
			onClose={() => {}}
		/>,
	);
	expect(markup).toBe("");
});
