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

function cacheRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return xdg;
	const home = homedir();
	return home ? join(home, ".cache") : tmpdir();
}

export function stagingRoot(): string {
	return join(cacheRoot(), "thinkrail");
}
