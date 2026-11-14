import { afterEach, expect, test } from "bun:test";
import type { NativePageZoomBridge } from "@thinkrail/contracts";
import { getNativePageZoomBridge, readNativePageZoomBridge } from "./nativePageZoom";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "__THINKRAIL_NATIVE_PAGE_ZOOM__");
});

test("getNativePageZoomBridge accepts only an object with a request function", () => {
	expect(getNativePageZoomBridge(undefined)).toBeNull();
	expect(getNativePageZoomBridge({})).toBeNull();
	expect(getNativePageZoomBridge({ request: "in" })).toBeNull();
	const bridge: NativePageZoomBridge = { request: () => {} };
	expect(getNativePageZoomBridge(bridge)).toBe(bridge);
});

test("readNativePageZoomBridge finds the preload's global and nothing in a browser", () => {
	expect(readNativePageZoomBridge()).toBeNull();
	const bridge: NativePageZoomBridge = Object.freeze({ request: () => {} });
	Reflect.set(globalThis, "__THINKRAIL_NATIVE_PAGE_ZOOM__", bridge);
	expect(readNativePageZoomBridge()).toBe(bridge);
});
