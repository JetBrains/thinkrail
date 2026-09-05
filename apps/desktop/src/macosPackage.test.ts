import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractTarSafely,
	type MacosPackageChannel,
	macosArtifactNames,
	postPackageExpandedMacosDmg,
	snapshotMacosAppBundle,
	validateExpandedMacosApp,
	validateExpandedMacosPackage,
} from "./macosPackage";

const roots: string[] = [];
const executableRoutes = [
	"Contents/MacOS/bspatch",
	"Contents/MacOS/bun",
	"Contents/MacOS/launcher",
	"Contents/MacOS/libasar.dylib",
	"Contents/MacOS/libNativeWrapper.dylib",
	"Contents/MacOS/zig-zstd",
	"Contents/Resources/app/runtime/macos-trash",
] as const;
const fileRoutes = [
	"Contents/Info.plist",
	...executableRoutes,
	"Contents/Resources/AppIcon.icns",
	"Contents/Resources/build.json",
	"Contents/Resources/main.js",
	"Contents/Resources/version.json",
	"Contents/Resources/app/bun/index.js",
	"Contents/Resources/app/runtime/librust_pty_arm64.dylib",
	"Contents/Resources/app/runtime/preload.js",
	"Contents/Resources/app/runtime/server-runtime.ts",
	"Contents/Resources/app/runtime/windows-trash.exe",
	"Contents/Resources/app/runtime/skills/example/SKILL.md",
	"Contents/Resources/app/views/web/index.html",
	"Contents/Resources/app/views/web/assets/app.js",
] as const;

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-macos-package-test-"));
	roots.push(root);
	return root;
}

function writeRoute(root: string, route: string, value = route): string {
	const path = join(root, ...route.split("/"));
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, value);
	return path;
}

function createApp(root: string, channel: MacosPackageChannel): string {
	const app = join(root, macosArtifactNames(channel).appBundle);
	mkdirSync(join(app, "Contents", "Frameworks"), { recursive: true });
	for (const route of fileRoutes) writeRoute(app, route);
	for (const route of executableRoutes) chmodSync(join(app, ...route.split("/")), 0o755);
	return app;
}

function createPackage(channel: MacosPackageChannel): { app: string; root: string } {
	const root = temporaryRoot();
	const app = createApp(root, channel);
	symlinkSync("/Applications", join(root, "Applications"));
	return { app, root };
}

interface TarEntry {
	readonly path: string;
	readonly type?: "0" | "2" | "5";
	readonly target?: string;
}

function writeTar(path: string, entries: readonly TarEntry[]): void {
	const blocks: Buffer[] = [];
	for (const entry of entries) {
		const header = Buffer.alloc(512);
		header.write(entry.path, 0, 100, "utf8");
		header.write("0000755\0", 100, 8, "ascii");
		header.write("0000000\0", 108, 8, "ascii");
		header.write("0000000\0", 116, 8, "ascii");
		header.write("00000000000\0", 124, 12, "ascii");
		header.write("00000000000\0", 136, 12, "ascii");
		header.fill(32, 148, 156);
		header.write(entry.type ?? "0", 156, 1, "ascii");
		if (entry.target) header.write(entry.target, 157, 100, "utf8");
		header.write("ustar\0", 257, 6, "ascii");
		header.write("00", 263, 2, "ascii");
		let checksum = 0;
		for (const byte of header) checksum += byte;
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
		blocks.push(header);
	}
	blocks.push(Buffer.alloc(1024));
	writeFileSync(path, Buffer.concat(blocks));
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("pins Electrobun's macOS ARM64 artifact names per channel", () => {
	expect(macosArtifactNames("stable")).toEqual({
		appBundle: "ThinkRail.app",
		appArchive: "stable-macos-arm64-ThinkRail.app.tar.zst",
		dmg: "stable-macos-arm64-ThinkRail.dmg",
		volume: "ThinkRail",
	});
	expect(macosArtifactNames("canary")).toEqual({
		appBundle: "ThinkRail-canary.app",
		appArchive: "canary-macos-arm64-ThinkRail-canary.app.tar.zst",
		dmg: "canary-macos-arm64-ThinkRail-canary.dmg",
		volume: "ThinkRail-canary",
	});
});

describe("expanded package validation", () => {
	for (const channel of ["canary", "stable"] as const) {
		test(`accepts the complete ${channel} ARM64 layout`, () => {
			const fixture = createPackage(channel);
			expect(validateExpandedMacosPackage(fixture.root, channel)).toBe(fixture.app);
		});
	}

	test("rejects legacy Electrobun extractor metadata and payload archives", () => {
		const fixture = createPackage("canary");
		const resources = join(fixture.app, "Contents", "Resources");
		writeFileSync(join(resources, "metadata.json"), "{}");
		expect(() => validateExpandedMacosApp(fixture.app, "canary")).toThrow(
			"legacy Electrobun extractor metadata",
		);
		rmSync(join(resources, "metadata.json"));
		writeFileSync(join(resources, "payload.tar.zst"), "payload");
		expect(() => validateExpandedMacosApp(fixture.app, "canary")).toThrow(
			"legacy Electrobun payload archive",
		);
	});

	test("rejects missing ARM64 runtime resources and package-root extras", () => {
		const fixture = createPackage("stable");
		rmSync(join(fixture.app, "Contents", "Resources", "app", "runtime", "librust_pty_arm64.dylib"));
		expect(() => validateExpandedMacosPackage(fixture.root, "stable")).toThrow(
			"Contents/Resources/app/runtime/librust_pty_arm64.dylib",
		);
		writeFileSync(join(fixture.root, ".DS_Store"), "extra");
		expect(() => validateExpandedMacosPackage(fixture.root, "stable")).toThrow(
			"must contain exactly Applications, ThinkRail.app",
		);
	});
});

describe("safe tar extraction", () => {
	test.each([
		"../escape",
		"/absolute",
		"ThinkRail.app/../../escape",
	])("rejects the traversal path %s before extraction", (path) => {
		const root = temporaryRoot();
		const tar = join(root, "unsafe.tar");
		const destination = join(root, "destination");
		mkdirSync(destination);
		writeTar(tar, [{ path }]);
		let ran = false;
		expect(() =>
			extractTarSafely(tar, destination, undefined, "tar", () => {
				ran = true;
			}),
		).toThrow("unsafe path");
		expect(ran).toBe(false);
	});

	test("rejects links and additional archive roots before extraction", () => {
		const root = temporaryRoot();
		const destination = join(root, "destination");
		mkdirSync(destination);
		const linked = join(root, "linked.tar");
		writeTar(linked, [
			{ path: "ThinkRail.app/", type: "5" },
			{ path: "ThinkRail.app/Contents/link", type: "2", target: "../../../escape" },
		]);
		expect(() => extractTarSafely(linked, destination, "ThinkRail.app", "tar", () => {})).toThrow(
			"unsupported link",
		);
		const extra = join(root, "extra.tar");
		writeTar(extra, [
			{ path: "ThinkRail.app/", type: "5" },
			{ path: "unexpected/", type: "5" },
		]);
		expect(() => extractTarSafely(extra, destination, "ThinkRail.app", "tar", () => {})).toThrow(
			"must contain exactly the ThinkRail.app root",
		);
	});
});

test("app bundle snapshots pin bytes, entry types, modes, and symlink targets", () => {
	const first = temporaryRoot();
	const second = temporaryRoot();
	for (const root of [first, second]) {
		const app = join(root, "ThinkRail.app");
		mkdirSync(join(app, "b"), { recursive: true });
		writeFileSync(join(app, "b", "value"), "same");
		writeFileSync(join(app, "a"), "first");
		symlinkSync("b/value", join(app, "link"));
	}
	const firstSnapshot = snapshotMacosAppBundle(join(first, "ThinkRail.app"));
	const secondApp = join(second, "ThinkRail.app");
	expect(snapshotMacosAppBundle(secondApp)).toEqual(firstSnapshot);
	expect(firstSnapshot.map((entry) => entry.path)).toEqual([".", "a", "b", "b/value", "link"]);

	writeFileSync(join(secondApp, "b", "value"), "changed");
	expect(snapshotMacosAppBundle(secondApp)).not.toEqual(firstSnapshot);
	writeFileSync(join(secondApp, "b", "value"), "same");

	const originalMode = firstSnapshot.find((entry) => entry.path === "a")?.mode;
	if (originalMode === undefined) throw new Error("snapshot omitted fixture file mode");
	chmodSync(join(secondApp, "a"), originalMode ^ 0o100);
	expect(snapshotMacosAppBundle(secondApp)).not.toEqual(firstSnapshot);
	chmodSync(join(secondApp, "a"), originalMode);

	rmSync(join(secondApp, "link"));
	symlinkSync("a", join(secondApp, "link"));
	expect(snapshotMacosAppBundle(secondApp)).not.toEqual(firstSnapshot);
	rmSync(join(secondApp, "link"));
	symlinkSync("b/value", join(secondApp, "link"));

	rmSync(join(secondApp, "b", "value"));
	mkdirSync(join(secondApp, "b", "value"));
	expect(snapshotMacosAppBundle(secondApp)).not.toEqual(firstSnapshot);
});

describe("expanded DMG post-packaging", () => {
	function setup(channel: MacosPackageChannel) {
		const desktop = temporaryRoot();
		const artifacts = join(desktop, "artifacts");
		mkdirSync(artifacts);
		const names = macosArtifactNames(channel);
		const archive = join(artifacts, names.appArchive);
		writeTar(archive, [{ path: `${names.appBundle}/`, type: "5" }]);
		const dmg = join(artifacts, names.dmg);
		writeFileSync(dmg, "wrapper");
		const zstd = join(desktop, "zig-zstd");
		writeFileSync(zstd, "tool");
		const source = temporaryRoot();
		createApp(source, channel);
		return { archive, artifacts, channel, desktop, dmg, names, source, zstd };
	}

	function runnerFor(
		fixture: ReturnType<typeof setup>,
		hdiutil: (command: readonly string[]) => void,
	) {
		return (command: readonly string[]): void => {
			if (command[0] === fixture.zstd) {
				copyFileSync(fixture.archive, command[command.indexOf("-o") + 1] ?? "");
				return;
			}
			if (command[0] === "tar") {
				const destination = command[command.indexOf("-C") + 1];
				if (!destination) throw new Error("missing tar destination");
				cpSync(
					join(fixture.source, fixture.names.appBundle),
					join(destination, fixture.names.appBundle),
					{
						recursive: true,
					},
				);
				return;
			}
			hdiutil(command);
		};
	}

	test("replaces the existing artifact only after hdiutil creates the expanded image", () => {
		const fixture = setup("canary");
		const commands: (readonly string[])[] = [];
		const result = postPackageExpandedMacosDmg(fixture.desktop, fixture.channel, {
			zstdPath: fixture.zstd,
			tarPath: "tar",
			hdiutilPath: "hdiutil",
			runCommand: runnerFor(fixture, (command) => {
				commands.push(command);
				const source = command[command.indexOf("-srcfolder") + 1];
				const output = command.at(-1);
				if (!source || !output) throw new Error("invalid hdiutil command");
				validateExpandedMacosPackage(source, "canary");
				writeFileSync(output, "expanded");
			}),
		});
		expect(result).toBe(fixture.dmg);
		expect(readFileSync(fixture.dmg, "utf8")).toBe("expanded");
		expect(commands).toEqual([
			[
				"hdiutil",
				"create",
				"-volname",
				"ThinkRail-canary",
				"-srcfolder",
				expect.any(String),
				"-ov",
				"-format",
				"ULFO",
				expect.any(String),
			],
		]);
		expect(
			readdirSync(fixture.artifacts).some((entry) => entry.startsWith(".macos-package-")),
		).toBe(false);
	});

	test("leaves the wrapper artifact untouched when image creation fails", () => {
		const fixture = setup("stable");
		expect(() =>
			postPackageExpandedMacosDmg(fixture.desktop, fixture.channel, {
				zstdPath: fixture.zstd,
				tarPath: "tar",
				hdiutilPath: "hdiutil",
				runCommand: runnerFor(fixture, () => {
					throw new Error("hdiutil failed");
				}),
			}),
		).toThrow("hdiutil failed");
		expect(readFileSync(fixture.dmg, "utf8")).toBe("wrapper");
		expect(
			readdirSync(fixture.artifacts).some((entry) => entry.startsWith(".macos-package-")),
		).toBe(false);
	});
});
