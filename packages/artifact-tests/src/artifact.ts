import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { binaryArtifactName } from "@thinkrail/cli/artifact";

export const repoRoot = resolve(import.meta.dir, "..", "..", "..");

export function binaryArtifactPath(explicit?: string): string {
	return resolve(explicit ?? join(repoRoot, "apps", "cli", "dist", binaryArtifactName()));
}

export function locateDesktopLauncher(
	desktopDir = join(repoRoot, "apps", "desktop"),
	explicit?: string,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string {
	if (explicit) {
		const launcher = resolve(explicit);
		if (!existsSync(launcher))
			throw new Error(`packaged desktop launcher not found at ${launcher}`);
		return launcher;
	}
	const os = platform === "darwin" ? "macos" : platform === "win32" ? "win" : "linux";
	const launcher = join(
		desktopDir,
		"build",
		`dev-${os}-${arch}`,
		...(platform === "darwin"
			? ["ThinkRail-dev.app", "Contents", "MacOS", "launcher"]
			: ["ThinkRail-dev", "bin", platform === "win32" ? "launcher.exe" : "launcher"]),
	);
	if (!existsSync(launcher)) {
		throw new Error(
			`packaged desktop launcher not found at ${launcher} — run \`bun run desktop:build\` first`,
		);
	}
	return launcher;
}

export function windowsSetupExecutableSuffix(channel: string): string {
	return channel === "stable" ? "-Setup.exe" : `-Setup-${channel}.exe`;
}

export function locateWindowsSetupExecutable(packageDir: string, channel: string): string {
	const name = `ThinkRail${windowsSetupExecutableSuffix(channel)}`;
	const installer = join(packageDir, name);
	if (!existsSync(installer)) {
		throw new Error(`desktop ZIP does not contain ${name}`);
	}
	return installer;
}
