import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	type CacheWarmingMode,
	type CacheWarmingSetting,
	isCacheWarmingMode,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { createPiSettings } from "./packages";

/** Pi 1.5.1 defaults to `idle`; ThinkRail keeps pi 1.5.0's behavior until the user opts in. */
export const THINKRAIL_DEFAULT_CACHE_WARMING: CacheWarmingMode = "streaming";

function userCacheWarmingMode(settings: SettingsManager): CacheWarmingMode | undefined {
	const mode: unknown = settings.getGlobalSettings().cacheWarming;
	return isCacheWarmingMode(mode) ? mode : undefined;
}

export function applyCacheWarmingDefault(settings: SettingsManager): void {
	const getMode = settings.getCacheWarmingMode.bind(settings);
	settings.getCacheWarmingMode = () =>
		userCacheWarmingMode(settings) === undefined ? THINKRAIL_DEFAULT_CACHE_WARMING : getMode();
}

function hostSettings(): SettingsManager {
	return createPiSettings(process.cwd(), undefined, { projectTrusted: false, packages: "all" });
}

export function readCacheWarmingSetting(): CacheWarmingSetting {
	const mode = userCacheWarmingMode(hostSettings());
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
	const errors = settings.drainErrors();
	if (errors.length > 0) {
		throw new CodedError("CACHE_WARMING_WRITE_FAILED", describe(errors));
	}
	return { mode, source: "user" };
}
