import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { applyLinuxWebKitRendererWorkaround } from "./linuxWebKitRenderer";

function recorder() {
	const calls: [string, string][] = [];
	return { calls, set: (name: string, value: string) => void calls.push([name, value]) };
}

test("sets WEBKIT_DISABLE_DMABUF_RENDERER to 1 on Linux when the key is absent", () => {
	const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
	const native = recorder();
	expect(() => applyLinuxWebKitRendererWorkaround(env, "linux", native.set)).not.toThrow();
	expect(env).toEqual({ HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: "1" });
	expect(native.calls).toEqual([["WEBKIT_DISABLE_DMABUF_RENDERER", "1"]]);
});

test("preserves an exported DMA-BUF renderer value, including an opt-out", () => {
	for (const value of ["1", "0"]) {
		const env: NodeJS.ProcessEnv = { HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: value };
		const native = recorder();
		applyLinuxWebKitRendererWorkaround(env, "linux", native.set);
		expect(env).toEqual({ HOME: "/home/user", WEBKIT_DISABLE_DMABUF_RENDERER: value });
		expect(native.calls).toEqual([]);
	}
});

test("leaves macOS and Windows environments unchanged", () => {
	for (const platform of ["darwin", "win32"] as const) {
		const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
		const native = recorder();
		applyLinuxWebKitRendererWorkaround(env, platform, native.set);
		expect(env).toEqual({ HOME: "/home/user" });
		expect(native.calls).toEqual([]);
	}
});

test.skipIf(process.platform !== "linux")(
	"importing the module sets the native libc environment",
	() => {
		const modulePath = resolve(import.meta.dir, "linuxWebKitRenderer.ts");
		const script = `
		import { dlopen, FFIType, CString } from "bun:ffi";
		await import(${JSON.stringify(modulePath)});
		const libc = dlopen("libc.so.6", { getenv: { args: [FFIType.cstring], returns: FFIType.ptr } });
		const ptr = libc.symbols.getenv(Buffer.from("WEBKIT_DISABLE_DMABUF_RENDERER\\0"));
		console.log(ptr ? new CString(ptr).toString() : "null");
	`;
		const env = { ...process.env };
		delete env.WEBKIT_DISABLE_DMABUF_RENDERER;
		const result = Bun.spawnSync([process.execPath, "-e", script], { env });
		expect(result.stderr.toString()).toBe("");
		expect(result.stdout.toString().trim()).toBe("1");
	},
);
