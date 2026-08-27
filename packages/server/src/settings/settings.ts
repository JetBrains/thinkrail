import type { AppConfig, AppConfigUpdate } from "@thinkrail/contracts";
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

export function updateConfig(partial: AppConfigUpdate): AppConfig {
	const { reviewModel, reviewEffort, ...rest } = partial;
	const next: AppConfig = { ...getConfig(), ...rest };
	if (reviewModel !== undefined) {
		if (reviewModel === null) delete next.reviewModel;
		else next.reviewModel = reviewModel;
	}
	if (reviewEffort !== undefined) {
		if (reviewEffort === null) delete next.reviewEffort;
		else next.reviewEffort = reviewEffort;
	}
	cached = next;
	saveConfig(next);
	publishSettings?.(next);
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}
