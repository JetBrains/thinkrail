import { expect, test } from "bun:test";
import { hasNativeMessageBridge } from "./nativeBridges";

test("a page inside a native webview with message bridges is recognised on every desktop engine", () => {
	expect(hasNativeMessageBridge({ __electrobunWebviewId: 1 })).toBe(true);
	expect(hasNativeMessageBridge({ webkit: { messageHandlers: {} } })).toBe(true);
	expect(hasNativeMessageBridge({ chrome: { webview: { postMessage() {} } } })).toBe(true);
});

test("an ordinary browser tab has no native message bridge", () => {
	expect(hasNativeMessageBridge({})).toBe(false);
	expect(hasNativeMessageBridge({ chrome: { runtime: {} } })).toBe(false);
	expect(hasNativeMessageBridge({ webkit: null })).toBe(false);
});
