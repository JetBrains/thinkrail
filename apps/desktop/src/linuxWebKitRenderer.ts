import { dlopen, FFIType } from "bun:ffi";

const RENDERER_KEY = "WEBKIT_DISABLE_DMABUF_RENDERER";

type NativeSetenv = (name: string, value: string) => void;

export function applyLinuxWebKitRendererWorkaround(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	setNativeEnv: NativeSetenv = setLibcEnv,
): void {
	if (platform !== "linux") return;
	if (env[RENDERER_KEY] !== undefined) return;
	env[RENDERER_KEY] = "1";
	setNativeEnv(RENDERER_KEY, "1");
}

function setLibcEnv(name: string, value: string): void {
	const libc = dlopen("libc.so.6", {
		setenv: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
	});
	try {
		libc.symbols.setenv(Buffer.from(`${name}\0`), Buffer.from(`${value}\0`), 0);
	} finally {
		libc.close();
	}
}

applyLinuxWebKitRendererWorkaround(process.env, process.platform);
