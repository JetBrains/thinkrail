// The server-synced app config (OUR settings, not the agent's) — theme today, an extensible bag. Reads
// `config.json` via `persistence`, merges a partial on update, and fans the new config out through an
// injected publisher (the same inversion `workspaces`/`terminal`/`agent`/`auth` use), so the WS-channel
// wiring stays in `host`.
import type { AppConfig } from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";

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

/** Merge a partial into the config, persist it, broadcast the new config, and return it. */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
	const next: AppConfig = { ...getConfig(), ...partial };
	cached = next;
	saveConfig(next);
	publishSettings?.(next);
	return next;
}

/** Drop the in-memory cache — the e2e reset seam, so a fresh data dir isn't shadowed by a stale config. */
export function resetConfigCache(): void {
	cached = null;
}
