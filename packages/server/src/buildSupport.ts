import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type DesktopRuntimeTarget =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-arm64"
	| "linux-x64"
	| "win32-x64";

export interface BundledExtensionSource {
	readonly specifier: string;
	readonly entry: string;
	readonly skills?: string;
}

export interface BuildRuntimeSources {
	readonly extensions: readonly BundledExtensionSource[];
	readonly ptyLibraries: Readonly<Record<DesktopRuntimeTarget, string>>;
	readonly trashHelpers: {
		readonly macos: string;
		readonly windows: string;
	};
}

const require = createRequire(import.meta.url);

function requiredPath(path: string): string {
	if (!existsSync(path)) throw new Error(`required runtime source is missing: ${path}`);
	return path;
}

export function resolveBuildRuntimeSources(): BuildRuntimeSources {
	const extensions = [
		{ specifier: "pi-web-access/index.ts" },
		{ specifier: "pi-visualize/index.ts" },
		{ specifier: "pi-spec-graph/index.ts", skills: true },
		{ specifier: "pi-thinkrail-workflow/index.ts", skills: true },
		{ specifier: "pi-todos/index.ts", skills: true },
	].map(({ specifier, skills }) => {
		const entry = require.resolve(specifier);
		return {
			specifier,
			entry,
			...(skills ? { skills: requiredPath(join(dirname(entry), "skills")) } : {}),
		};
	});
	const ptyRelease = join(
		dirname(require.resolve("bun-pty")),
		"..",
		"rust-pty",
		"target",
		"release",
	);
	const trashLib = join(dirname(require.resolve("trash")), "lib");
	return {
		extensions,
		ptyLibraries: {
			"darwin-arm64": requiredPath(join(ptyRelease, "librust_pty_arm64.dylib")),
			"darwin-x64": requiredPath(join(ptyRelease, "librust_pty.dylib")),
			"linux-arm64": requiredPath(join(ptyRelease, "librust_pty_arm64.so")),
			"linux-x64": requiredPath(join(ptyRelease, "librust_pty.so")),
			"win32-x64": requiredPath(join(ptyRelease, "rust_pty.dll")),
		},
		trashHelpers: {
			macos: requiredPath(join(trashLib, "macos-trash")),
			windows: requiredPath(join(trashLib, "windows-trash.exe")),
		},
	};
}
