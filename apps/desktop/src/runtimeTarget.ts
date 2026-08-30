export type RuntimeTarget =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-arm64"
	| "linux-x64"
	| "win32-x64";

export function runtimeTarget(platform: NodeJS.Platform, arch: string): RuntimeTarget {
	const target = `${platform}-${arch}`;
	if (
		target === "darwin-arm64" ||
		target === "darwin-x64" ||
		target === "linux-arm64" ||
		target === "linux-x64" ||
		target === "win32-x64"
	) {
		return target;
	}
	throw new Error(`unsupported desktop runtime target: ${target}`);
}

export function ptyLibraryName(target: RuntimeTarget): string {
	if (target === "darwin-arm64") return "librust_pty_arm64.dylib";
	if (target === "darwin-x64") return "librust_pty.dylib";
	if (target === "linux-arm64") return "librust_pty_arm64.so";
	if (target === "linux-x64") return "librust_pty.so";
	return "rust_pty.dll";
}
