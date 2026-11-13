import type { NativePageZoomBridge } from "@thinkrail/contracts";

const NATIVE_PAGE_ZOOM_GLOBAL = "__THINKRAIL_NATIVE_PAGE_ZOOM__";

export function getNativePageZoomBridge(value: unknown): NativePageZoomBridge | null {
	if (typeof value !== "object" || value === null) return null;
	return typeof Reflect.get(value, "request") === "function"
		? (value as NativePageZoomBridge)
		: null;
}

export function readNativePageZoomBridge(): NativePageZoomBridge | null {
	return getNativePageZoomBridge(Reflect.get(globalThis, NATIVE_PAGE_ZOOM_GLOBAL));
}
