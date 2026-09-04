import {
	type AppConfig,
	type AppConfigUpdate,
	isJbcentralQuotaRefreshSeconds,
	isSystemThemePair,
	isThemeMode,
} from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";
import { normalizeStoredCustomLayoutPresets, validateCustomLayoutPresets } from "./layoutPresets";

type SettingsPublisher = (config: AppConfig) => void;
type RuntimeAppConfigUpdate = AppConfigUpdate & {
	chatMessageOrder?: unknown;
	layout?: unknown;
};

let publishSettings: SettingsPublisher | null = null;

export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
	if (cached) return cached;
	const loaded = loadConfig();
	const customLayoutPresets = normalizeStoredCustomLayoutPresets(loaded.customLayoutPresets);
	cached = { ...loaded, customLayoutPresets };
	if (JSON.stringify(customLayoutPresets) !== JSON.stringify(loaded.customLayoutPresets)) {
		saveConfig(cached);
	}
	return cached;
}

export function updateConfig(partial: AppConfigUpdate): AppConfig {
	const runtimeUpdate: RuntimeAppConfigUpdate = { ...partial };
	delete runtimeUpdate.chatMessageOrder;
	delete runtimeUpdate.layout;
	const {
		reviewModel,
		reviewEffort,
		customLayoutPresets,
		subagentsEnabled,
		theme,
		themeMode,
		systemThemePair,
		jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds,
		...rest
	} = runtimeUpdate;
	if (subagentsEnabled !== undefined && typeof subagentsEnabled !== "boolean") {
		throw new Error("subagentsEnabled must be a boolean");
	}
	if (jbcentralQuotaEnabled !== undefined && typeof jbcentralQuotaEnabled !== "boolean") {
		throw new Error("jbcentralQuotaEnabled must be a boolean");
	}
	if (
		jbcentralQuotaRefreshSeconds !== undefined &&
		!isJbcentralQuotaRefreshSeconds(jbcentralQuotaRefreshSeconds)
	) {
		throw new Error("jbcentralQuotaRefreshSeconds must be a whole number from 1 to 3600");
	}
	if (themeMode !== undefined && !isThemeMode(themeMode)) {
		throw new Error("themeMode must be fixed or system");
	}
	if (systemThemePair !== undefined && !isSystemThemePair(systemThemePair)) {
		throw new Error("systemThemePair must contain light and dark theme ids");
	}
	const current = getConfig();
	const nextThemeMode = themeMode ?? (theme !== undefined ? "fixed" : current.themeMode);
	const nextSystemThemePair =
		systemThemePair === undefined
			? current.systemThemePair
			: { light: systemThemePair.light, dark: systemThemePair.dark };
	if (nextThemeMode === "system" && !nextSystemThemePair) {
		throw new Error("system theme mode requires a complete pair");
	}
	const next: AppConfig = {
		...current,
		...rest,
		...(theme === undefined ? {} : { theme }),
		themeMode: nextThemeMode,
		...(nextSystemThemePair ? { systemThemePair: nextSystemThemePair } : {}),
		...(subagentsEnabled === undefined ? {} : { subagentsEnabled }),
		...(jbcentralQuotaEnabled === undefined ? {} : { jbcentralQuotaEnabled }),
		...(jbcentralQuotaRefreshSeconds === undefined ? {} : { jbcentralQuotaRefreshSeconds }),
		...(customLayoutPresets === undefined
			? {}
			: { customLayoutPresets: validateCustomLayoutPresets(customLayoutPresets) }),
	};
	if (reviewModel !== undefined) {
		if (reviewModel === null) delete next.reviewModel;
		else next.reviewModel = reviewModel;
	}
	if (reviewEffort !== undefined) {
		if (reviewEffort === null) delete next.reviewEffort;
		else next.reviewEffort = reviewEffort;
	}
	saveConfig(next);
	cached = next;
	publishSettings?.(next);
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}
