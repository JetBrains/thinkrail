// The server-synced app config (OUR settings, not the agent's) — theme today, an extensible bag. Reads
// `config.json` via `persistence`, merges a partial on update, and fans the new config out through an
// injected publisher (the same inversion `workspaces`/`terminal`/`agent`/`auth` use), so the WS-channel
// wiring stays in `host`.
import { type AppConfig, DEFAULT_CONFIG } from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";

/** The inclusive range `gitRemoteCheckIntervalMinutes` is clamped to — see {@link clampRemoteCheckFields}. */
const MIN_REMOTE_CHECK_INTERVAL_MINUTES = 1;
const MAX_REMOTE_CHECK_INTERVAL_MINUTES = 1440;

const GIT_REMOTE_CHECK_MODES: readonly AppConfig["gitRemoteCheck"][] = ["probe", "fetch", "off"];

/**
 * `updateConfig` accepts a partial straight off the wire — from any connected client, buggy or hostile —
 * and otherwise applies it verbatim. This is the one place the two remote-check fields are validated
 * before they reach `saveConfig`/the broadcast, so the rule is testable on its own and visible here rather
 * than buried in `updateConfig`'s spread:
 * - `gitRemoteCheckIntervalMinutes` is clamped to `[{@link MIN_REMOTE_CHECK_INTERVAL_MINUTES},
 *   {@link MAX_REMOTE_CHECK_INTERVAL_MINUTES}]` — an out-of-range value from a buggy or hostile client must
 *   not become a one-second poll. A **non-finite** value (`NaN`, `Infinity`) falls back to the *default*,
 *   not to a clamp bound: neither bound is a meaningful reading of "not a number".
 * - `gitRemoteCheck` falls back to the default when it names a mode this host doesn't recognise (an
 *   unrecognised value must never silently disable checks, nor crash the settings tee).
 *
 * Only touches the two keys actually present in `partial`; every other key passes through `updateConfig`'s
 * own spread untouched.
 */
function clampRemoteCheckFields(partial: Partial<AppConfig>): Partial<AppConfig> {
	const clamped: Partial<AppConfig> = { ...partial };
	if (partial.gitRemoteCheckIntervalMinutes !== undefined) {
		const raw = partial.gitRemoteCheckIntervalMinutes;
		clamped.gitRemoteCheckIntervalMinutes = Number.isFinite(raw)
			? Math.min(
					MAX_REMOTE_CHECK_INTERVAL_MINUTES,
					Math.max(MIN_REMOTE_CHECK_INTERVAL_MINUTES, raw),
				)
			: DEFAULT_CONFIG.gitRemoteCheckIntervalMinutes;
	}
	if (partial.gitRemoteCheck !== undefined) {
		clamped.gitRemoteCheck = GIT_REMOTE_CHECK_MODES.includes(partial.gitRemoteCheck)
			? partial.gitRemoteCheck
			: DEFAULT_CONFIG.gitRemoteCheck;
	}
	return clamped;
}

type SettingsPublisher = (config: AppConfig) => void;

// Injected by the host; `null` in unit tests / the e2e reset → the broadcast is a silent no-op.
let publishSettings: SettingsPublisher | null = null;

/** Install (or clear with `null`) the sink `settings.changed` is fanned out through. */
export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

// Lazily loaded + cached, so `getConfig()` (called for every `server.welcome`) doesn't hit disk each time.
let cached: AppConfig | null = null;

/** The current app config (cached; loaded from `config.json` on first read, merged over `DEFAULT_CONFIG`). */
export function getConfig(): AppConfig {
	cached ??= loadConfig();
	return cached;
}

/**
 * Merge a partial into the config, persist it, broadcast the new config, and return it. The remote-check
 * fields are clamped ({@link clampRemoteCheckFields}) after the merge, so nothing a client sends for them
 * reaches disk or the broadcast unvalidated; every other key is accepted verbatim.
 */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
	const next: AppConfig = { ...getConfig(), ...partial, ...clampRemoteCheckFields(partial) };
	cached = next;
	saveConfig(next);
	publishSettings?.(next);
	return next;
}

/** Drop the in-memory cache — the e2e reset seam, so a fresh data dir isn't shadowed by a stale config. */
export function resetConfigCache(): void {
	cached = null;
}
