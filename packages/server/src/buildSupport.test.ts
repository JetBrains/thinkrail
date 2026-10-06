import { expect, test } from "bun:test";
import { basename, dirname } from "node:path";
import { resolveBuildRuntimeSources } from "./buildSupport";
import { resolveExtensionSkillRoots, serverExtensions } from "./extensions";

test("runtime source manifest covers the launcher artifact surface", () => {
	const sources = resolveBuildRuntimeSources();
	expect(sources.extensions.map((extension) => extension.specifier)).toEqual([
		"pi-web-access/index.ts",
		"pi-spec-graph/index.ts",
		"pi-thinkrail-workflow/index.ts",
		"pi-todos/index.ts",
	]);
	expect(sources.extensions.map((extension) => extension.specifier)).not.toContain(
		expect.stringContaining("visualize"),
	);
	expect(sources.webAccessIndex).toBe(0);
	const piPackageSkillRoots = sources.extensions
		.slice(1)
		.map((extension) => `${dirname(extension.entry)}/skills`);
	expect(sources.skillRoots).toEqual([
		...piPackageSkillRoots,
		...serverExtensions.flatMap(resolveExtensionSkillRoots),
	]);
	expect(sources.skillRoots.map((root) => basename(dirname(root)))).toEqual([
		"spec-graph",
		"pi-thinkrail-workflow",
		"pi-todos",
	]);
	expect(
		Object.fromEntries(
			Object.entries(sources.ptyLibraries).map(([target, path]) => [target, basename(path)]),
		),
	).toEqual({
		"darwin-arm64": "librust_pty_arm64.dylib",
		"darwin-x64": "librust_pty.dylib",
		"linux-arm64": "librust_pty_arm64.so",
		"linux-x64": "librust_pty.so",
		"win32-x64": "rust_pty.dll",
	});
	expect(basename(sources.trashHelpers.macos)).toBe("macos-trash");
	expect(basename(sources.trashHelpers.windows)).toBe("windows-trash.exe");
});
