// Where an *installed* ThinkRail keeps its own files: the metadata the installers record
// (`install.json`) and the cache the compiled binary self-extracts into. One module so the three
// readers can't drift — `compiled-entry` stages into the cache, `update` reads the channel/prefix it
// was installed with, and `uninstall` removes both. (The user's *app state* is a different thing
// entirely: that lives under the server's `dataDir()`.)

import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What `install.sh` / `install.ps1` write into `install.json`. Every field is `unknown` on purpose: the
 * file is plain JSON in the user's home, so a reader must validate before trusting it (see
 * `resolveUpdatePlan` / `resolveWindowsInstallPrefix`).
 */
export interface InstallMeta {
	channel?: unknown;
	version?: unknown;
	tag?: unknown;
	prefix?: unknown;
	/**
	 * Windows only: did *that* install put `<prefix>\bin` on the user PATH? Written by install.ps1 (sticky
	 * across re-installs of the same prefix) and read only by `uninstall`, which will not remove a registry
	 * PATH entry it can't prove is ours. Absent — legacy metadata, or an install.sh/Git-Bash install, which
	 * never touches the Windows PATH — means **not ours**.
	 */
	path_entry_added?: unknown;
}

/** `<home>/.config/thinkrail` — where both installers record the install. */
export function installConfigDir(home: string): string {
	return join(home, ".config", "thinkrail");
}

/** `<home>/.config/thinkrail/install.json`. */
export function installMetaFile(home: string): string {
	return join(installConfigDir(home), "install.json");
}

/** Parsed `install.json`, or `{}` when it's absent, unreadable, or not a JSON object. */
export function readInstallMeta(home: string): InstallMeta {
	try {
		const parsed: unknown = JSON.parse(readFileSync(installMetaFile(home), "utf8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as InstallMeta) : {};
	} catch {
		return {};
	}
}

/** A writable cache root: `$XDG_CACHE_HOME`, else `~/.cache`, else the OS temp dir. */
function cacheRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return xdg;
	const home = homedir();
	return home ? join(home, ".cache") : tmpdir();
}

/**
 * `<cacheRoot>/thinkrail` — everything the compiled binary self-extracts (the web assets + the bundled
 * skills, each under a content-hashed subdir). Disposable: a launch re-creates whatever is missing.
 */
export function stagingRoot(): string {
	return join(cacheRoot(), "thinkrail");
}
