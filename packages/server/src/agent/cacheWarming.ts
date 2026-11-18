import { statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	type CacheWarmingMode,
	type CacheWarmingSetting,
	isCacheWarmingMode,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { createPiSettings } from "./packages";

/** Pi defaults to `idle` since 1.5.1; idle warming spends in the background, so it stays opt-in here. */
const THINKRAIL_DEFAULT_CACHE_WARMING: CacheWarmingMode = "streaming";

function userCacheWarmingMode(settings: SettingsManager): CacheWarmingMode | undefined {
	const mode: unknown = settings.getGlobalSettings().cacheWarming;
	return isCacheWarmingMode(mode) ? mode : undefined;
}

function hostSettings(): SettingsManager {
	return createPiSettings(process.cwd(), undefined, { projectTrusted: false, packages: "all" });
}

interface FileStamp {
	readonly path: string;
	readonly mtimeMs: number;
	readonly size: number;
}

let known: { stamp: FileStamp; mode: CacheWarmingMode | undefined } | undefined;

function settingsStamp(): FileStamp {
	const path = join(getAgentDir(), "settings.json");
	try {
		const stat = statSync(path);
		return { path, mtimeMs: stat.mtimeMs, size: stat.size };
	} catch {
		return { path, mtimeMs: -1, size: -1 };
	}
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
	return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** The mode pi's global `settings.json` names right now, re-read only when the file changed. */
function persistedCacheWarmingMode(): CacheWarmingMode | undefined {
	const stamp = settingsStamp();
	if (known && sameStamp(known.stamp, stamp)) return known.mode;
	const mode = userCacheWarmingMode(hostSettings());
	known = { stamp, mode };
	return mode;
}

/**
 * Every session's warmer asks the file, not the snapshot its `SettingsManager` loaded, so a chat,
 * a delegated child or a session still being created follows a change at its next decision.
 */
export function applyCacheWarmingDefault(settings: SettingsManager): void {
	settings.getCacheWarmingMode = () =>
		persistedCacheWarmingMode() ?? THINKRAIL_DEFAULT_CACHE_WARMING;
}

export function readCacheWarmingSetting(): CacheWarmingSetting {
	const mode = persistedCacheWarmingMode();
	return mode === undefined
		? { mode: THINKRAIL_DEFAULT_CACHE_WARMING, source: "default" }
		: { mode, source: "user" };
}

function describe(errors: readonly { error: Error }[]): string {
	return errors.map((entry) => entry.error.message).join("; ");
}

/** Persist the mode in pi's global settings; pi's `save()` silently skips a file it could not parse. */
export async function writeCacheWarmingMode(mode: CacheWarmingMode): Promise<CacheWarmingSetting> {
	if (!isCacheWarmingMode(mode)) {
		throw new CodedError("CACHE_WARMING_WRITE_FAILED", `Unknown cache-warming mode "${mode}".`);
	}
	const settings = hostSettings();
	const loadErrors = settings.drainErrors().filter((entry) => entry.scope === "global");
	if (loadErrors.length > 0) {
		throw new CodedError(
			"CACHE_WARMING_WRITE_FAILED",
			`The pi settings file cannot be read: ${describe(loadErrors)}`,
		);
	}
	settings.setCacheWarmingMode(mode);
	await settings.flush();
	known = undefined;
	const errors = settings.drainErrors();
	if (errors.length > 0) {
		throw new CodedError("CACHE_WARMING_WRITE_FAILED", describe(errors));
	}
	return { mode, source: "user" };
}
