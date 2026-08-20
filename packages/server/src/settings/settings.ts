import type { AppConfig } from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";

type SettingsPublisher = (config: AppConfig) => void;

let publishSettings: SettingsPublisher | null = null;

export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
	cached ??= loadConfig();
	return cached;
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
	const next: AppConfig = { ...getConfig(), ...partial };
	cached = next;
	saveConfig(next);
	publishSettings?.(next);
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}
