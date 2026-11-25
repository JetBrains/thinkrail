import { expect, test } from "bun:test";
import { applyLinuxWebKitRendererWorkaround } from "./linuxWebKitRenderer";

test("sets WEBKIT_DISABLE_DMABUF_RENDERER to 1 on Linux when the key is absent", () => {
	const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
	expect(() => applyLinuxWebKitRendererWorkaround(env, "linux")).not.toThrow();
	expect(env).toEqual({ HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: "1" });
});

test("preserves an exported DMA-BUF renderer value, including an opt-out", () => {
	for (const value of ["1", "0"]) {
		const env: NodeJS.ProcessEnv = { HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: value };
		applyLinuxWebKitRendererWorkaround(env, "linux");
		expect(env).toEqual({ HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: value });
	}
});

test("leaves macOS and Windows environments unchanged", () => {
	for (const platform of ["darwin", "win32"] as const) {
		const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
		applyLinuxWebKitRendererWorkaround(env, platform);
		expect(env).toEqual({ HOME: "/home/user" });
	}
});
