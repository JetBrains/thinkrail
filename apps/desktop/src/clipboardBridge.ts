import type { NativeClipboardBridge, NativeClipboardContent } from "@thinkrail/contracts";

export const NATIVE_CLIPBOARD_GLOBAL = "__THINKRAIL_NATIVE_CLIPBOARD__";

const NOTHING: NativeClipboardContent = { kind: "none" };

export function needsNativeClipboard(platform: string): boolean {
	return platform.startsWith("Linux");
}

export function createClipboardBridge(
	read: () => Promise<NativeClipboardContent>,
): NativeClipboardBridge {
	return Object.freeze({ read: () => read().catch(() => NOTHING) });
}
