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

/**
 * The current app config — read from `config.json` on every call (merged over `DEFAULT_CONFIG` by
 * `loadConfig`). Per-request like `projects.json`/`workspaces.json`: file-seeded state is visible
 * immediately, which is what keeps e2e tests isolated on one shared host. The read is one tiny JSON file.
 */
export function getConfig(): AppConfig {
	return loadConfig();
}

/** Merge a partial into the config, persist it, broadcast the new config, and return it. */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
	const next: AppConfig = { ...getConfig(), ...partial };
	saveConfig(next);
	publishSettings?.(next);
	return next;
}
