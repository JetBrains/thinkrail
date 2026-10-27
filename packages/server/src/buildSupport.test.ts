import { expect, test } from "bun:test";
import { basename, dirname, join } from "node:path";
import { resolveBuildRuntimeSources } from "./buildSupport";
import {
	resolveExtensionSkillRoots,
	serverExtensions,
	stagedExtensionSkillRoute,
} from "./extensions";

test("runtime source manifest covers the launcher artifact surface", () => {
	const sources = resolveBuildRuntimeSources();
	expect(sources.extensions.map((extension) => extension.specifier)).toEqual([
		"pi-spec-graph/index.ts",
		"pi-thinkrail-workflow/index.ts",
		"pi-todos/index.ts",
	]);
	expect(sources.extensions.map((extension) => extension.specifier)).not.toContain(
		expect.stringMatching(/visualize|web-access/),
	);
	const piPackageSkillRoots = sources.extensions.map((extension) =>
		join(dirname(extension.entry), "skills"),
	);
	expect(sources.skillRoots).toEqual([
		...[...piPackageSkillRoots, join(import.meta.dir, "..", "skills")].map((source) => ({
			source,
			route: "",
		})),
		...serverExtensions.flatMap((entry) =>
			resolveExtensionSkillRoots(entry).map((source) => ({
				source,
				route: stagedExtensionSkillRoute(entry.extension.name),
			})),
		),
	]);
	expect(sources.skillRoots.map(({ source, route }) => [basename(dirname(source)), route])).toEqual(
		[
			["spec-graph", ""],
			["pi-thinkrail-workflow", ""],
			["pi-todos", ""],
			["server", ""],
			["pi-web-access", "extensions/web-access"],
		],
	);
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
