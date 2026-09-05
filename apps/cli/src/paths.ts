import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface InstallMeta {
	channel?: unknown;
	version?: unknown;
	tag?: unknown;
	prefix?: unknown;
	path_entry_added?: unknown;
}

export function installConfigDir(home: string): string {
	return join(home, ".config", "thinkrail");
}

export function installMetaFile(home: string): string {
	return join(installConfigDir(home), "install.json");
}

export function readInstallMeta(home: string): InstallMeta {
	try {
		const parsed: unknown = JSON.parse(readFileSync(installMetaFile(home), "utf8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as InstallMeta) : {};
	} catch {
		return {};
	}
}

export function isAbsoluteInstallPath(path: string, windows: boolean): boolean {
	return windows ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/.test(path) : path.startsWith("/");
}

export function installedPrefix(installMeta: InstallMeta, home: string, windows: boolean): string {
	const recorded = installMeta.prefix;
	return typeof recorded === "string" && isAbsoluteInstallPath(recorded, windows)
		? recorded
		: join(home, ".local");
}

export function installedBinaryName(windows: boolean): string {
	return windows ? "thinkrail.exe" : "thinkrail";
}

export function installedBinaryPath(
	installMeta: InstallMeta,
	home: string,
	windows: boolean,
): string {
	return join(installedPrefix(installMeta, home, windows), "bin", installedBinaryName(windows));
}

function cacheRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return xdg;
	const home = homedir();
	return home ? join(home, ".cache") : tmpdir();
}

export function stagingRoot(): string {
	return join(cacheRoot(), "thinkrail");
}
