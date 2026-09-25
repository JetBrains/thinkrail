import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";

export interface InstallMeta {
	channel?: unknown;
	version?: unknown;
	tag?: unknown;
	prefix?: unknown;
	path_entry_added?: unknown;
}

export function normalizeWindowsInstallPrefix(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	let prefix = value.replace(/\\/g, "/");
	const cygdrive = prefix.match(/^\/cygdrive\/([A-Za-z])(?:\/(.*))?$/);
	if (cygdrive) {
		prefix = `${cygdrive[1]?.toUpperCase()}:/${cygdrive[2] ?? ""}`;
	} else {
		const gitBash = prefix.match(/^\/([A-Za-z])(?:\/(.*))?$/);
		if (gitBash) prefix = `${gitBash[1]?.toUpperCase()}:/${gitBash[2] ?? ""}`;
	}
	if (!/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+(?:\/|$))/.test(prefix)) return undefined;
	const normalized = win32.normalize(prefix).replace(/\\/g, "/");
	return /^[A-Za-z]:/.test(normalized)
		? `${normalized[0]?.toUpperCase()}${normalized.slice(1)}`
		: normalized;
}

export function sameWindowsPath(a: string, b: string): boolean {
	const normalized = (value: string) =>
		win32.normalize(value).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
	return normalized(a) === normalized(b);
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
