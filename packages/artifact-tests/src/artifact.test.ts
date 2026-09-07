import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { binaryArtifactName } from "@thinkrail/cli/artifact";
import { removeTree } from "@thinkrail/shared/removeTree";
import {
	binaryArtifactPath,
	locateDesktopLauncher,
	locateWindowsSetupExecutable,
	windowsSetupExecutableSuffix,
} from "./artifact";
import * as artifactTests from "./index";

const roots: string[] = [];

function packageDir(...files: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-artifact-test-"));
	roots.push(root);
	for (const file of files) {
		const path = join(root, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "");
	}
	return root;
}

const desktopTargets: {
	platform: NodeJS.Platform;
	arch: string;
	launcher: string;
	decoy: string;
}[] = [
	{
		platform: "darwin",
		arch: "arm64",
		launcher: "build/dev-macos-arm64/ThinkRail-dev.app/Contents/MacOS/launcher",
		decoy: "build/dev-macos-arm64/Another.app/Contents/MacOS/launcher",
	},
	{
		platform: "win32",
		arch: "x64",
		launcher: "build/dev-win-x64/ThinkRail-dev/bin/launcher.exe",
		decoy: "build/dev-win-x64/Another/bin/launcher.exe",
	},
	{
		platform: "linux",
		arch: "x64",
		launcher: "build/dev-linux-x64/ThinkRail-dev/bin/launcher",
		decoy: "build/dev-linux-x64/Another/bin/launcher",
	},
	{
		platform: "linux",
		arch: "arm64",
		launcher: "build/dev-linux-arm64/ThinkRail-dev/bin/launcher",
		decoy: "build/dev-linux-arm64/Another/bin/launcher",
	},
];

afterEach(() => {
	for (const root of roots.splice(0)) removeTree(root);
});

test("the public barrel exposes only the pure desktop locator", () => {
	expect(Object.keys(artifactTests)).toEqual(["locateDesktopLauncher"]);
	expect(artifactTests.locateDesktopLauncher).toBe(locateDesktopLauncher);
});

test.each(
	desktopTargets,
)("locates the documented dev launcher for $platform $arch, not another bundle", ({
	platform,
	arch,
	launcher,
	decoy,
}) => {
	const root = packageDir(decoy, launcher);
	expect(locateDesktopLauncher(root, undefined, platform, arch)).toBe(join(root, launcher));
});

test.each(
	desktopTargets,
)("refuses other bundles when the dev launcher is missing for $platform $arch", ({
	platform,
	arch,
	launcher,
	decoy,
}) => {
	const root = packageDir(decoy);
	expect(() => locateDesktopLauncher(root, undefined, platform, arch)).toThrow(
		`packaged desktop launcher not found at ${join(root, launcher)}`,
	);
});

test("resolves an explicit desktop launcher relative to the caller, outside the default tree", () => {
	const root = packageDir("custom-launcher");
	const explicit = relative(process.cwd(), join(root, "custom-launcher"));
	expect(locateDesktopLauncher(join(root, "missing"), explicit)).toBe(
		join(root, "custom-launcher"),
	);
});

test("refuses a missing explicit desktop launcher", () => {
	const root = packageDir();
	const missing = join(root, "missing");
	expect(() => locateDesktopLauncher(root, missing)).toThrow(
		`packaged desktop launcher not found at ${missing}`,
	);
});

test("resolves an explicit CLI binary relative to the caller", () => {
	const root = packageDir("custom-binary");
	const explicit = relative(process.cwd(), join(root, "custom-binary"));
	expect(binaryArtifactPath(explicit)).toBe(join(root, "custom-binary"));
});

test("default artifact paths stay rooted at the repository from every invocation directory", () => {
	const repo = resolve(import.meta.dir, "..", "..", "..");
	const os =
		process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : "linux";
	const launcher = join(
		repo,
		"apps",
		"desktop",
		"build",
		`dev-${os}-${process.arch}`,
		...(process.platform === "darwin"
			? ["ThinkRail-dev.app", "Contents", "MacOS", "launcher"]
			: ["ThinkRail-dev", "bin", process.platform === "win32" ? "launcher.exe" : "launcher"]),
	);
	const source = `
		import { binaryArtifactPath, locateDesktopLauncher } from ${JSON.stringify(join(import.meta.dir, "artifact.ts"))};
		let desktop;
		try { desktop = locateDesktopLauncher(); }
		catch (error) { desktop = error.message; }
		console.log(JSON.stringify({ binary: binaryArtifactPath(), desktop }));
	`;
	for (const cwd of [repo, resolve(import.meta.dir, ".."), packageDir()]) {
		const result = Bun.spawnSync([process.execPath, "--eval", source], { cwd });
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
		const paths = JSON.parse(result.stdout.toString());
		expect(paths.binary).toBe(join(repo, "apps", "cli", "dist", binaryArtifactName()));
		expect([
			launcher,
			`packaged desktop launcher not found at ${launcher} — run \`bun run desktop:build\` first`,
		]).toContain(paths.desktop);
	}
});

test("names the Windows setup executable per channel", () => {
	expect(windowsSetupExecutableSuffix("stable")).toBe("-Setup.exe");
	expect(windowsSetupExecutableSuffix("canary")).toBe("-Setup-canary.exe");
});

test("locates the channel-suffixed setup executable inside an expanded ZIP", () => {
	const root = packageDir(
		"ThinkRail-Setup-canary.exe",
		join(".installer", "ThinkRail-Setup-canary.tar.zst"),
	);
	expect(locateWindowsSetupExecutable(root, "canary")).toBe(
		join(root, "ThinkRail-Setup-canary.exe"),
	);
});

test("locates the unsuffixed setup executable for the stable channel", () => {
	const root = packageDir("ThinkRail-Setup.exe");
	expect(locateWindowsSetupExecutable(root, "stable")).toBe(join(root, "ThinkRail-Setup.exe"));
});

test("refuses a ZIP whose setup executable belongs to another channel", () => {
	const root = packageDir("ThinkRail-Setup-canary.exe");
	expect(() => locateWindowsSetupExecutable(root, "stable")).toThrow(
		"desktop ZIP does not contain ThinkRail-Setup.exe",
	);
});

test.each(["stable", "canary"])("selects only ThinkRail's exact %s setup name", (channel) => {
	const root = packageDir(
		"Another-Setup.exe",
		"Another-Setup-canary.exe",
		"ThinkRail-Setup.exe",
		"ThinkRail-Setup-canary.exe",
	);
	expect(locateWindowsSetupExecutable(root, channel)).toBe(
		join(root, `ThinkRail${windowsSetupExecutableSuffix(channel)}`),
	);
});

test.each([
	"stable",
	"canary",
])("refuses similarly named or nested %s setup executables", (channel) => {
	const name = `ThinkRail${windowsSetupExecutableSuffix(channel)}`;
	const root = packageDir(`Another${windowsSetupExecutableSuffix(channel)}`, join("other", name));
	expect(() => locateWindowsSetupExecutable(root, channel)).toThrow(
		`desktop ZIP does not contain ${name}`,
	);
});
