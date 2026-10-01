import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { preferNativeHostBridge, usesNativeHostBridge } from "./hostTransport";

test("only Windows routes webview RPC through the native host bridge", () => {
	expect(usesNativeHostBridge("win32")).toBe(true);
	for (const platform of ["darwin", "linux", "freebsd"] as const) {
		expect(usesNativeHostBridge(platform)).toBe(false);
	}
});

test("the preload runs without the loopback host-socket ports", () => {
	const context: Record<string, unknown> = {
		__electrobunHostSocketPort: 50000,
		__electrobunRpcSocketPort: 50000,
		__electrobunWebviewId: 1,
	};
	runInNewContext(
		preferNativeHostBridge(
			"globalThis.seen = [globalThis.__electrobunHostSocketPort ?? globalThis.__electrobunRpcSocketPort, globalThis.__electrobunWebviewId];",
		),
		context,
	);
	expect(context.seen).toEqual([undefined, 1]);
	expect("__electrobunHostSocketPort" in context).toBe(false);
	expect("__electrobunRpcSocketPort" in context).toBe(false);
});
