import {
	type AppConfig,
	type AppConfigUpdate,
	COMPOSER_GROWTH_LIMITS,
	isComposerGrowthLimit,
	isJbcentralQuotaRefreshSeconds,
	isLineWidth,
	isSettleIdleDays,
	isSubagentMaxConcurrent,
	isSystemThemePair,
	isTerminalWindowsShell,
	isThemeMode,
	LINE_WIDTH_COLUMNS,
	RECENT_MODELS_LIMIT,
	sameModel,
	type WireModel,
} from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";
import { normalizeStoredCustomLayoutPresets, validateCustomLayoutPresets } from "./layoutPresets";

export type SettingsPublisher = (config: AppConfig, appliedUpdate: AppConfigUpdate) => void;
type RuntimeAppConfigUpdate = AppConfigUpdate & {
	chatMessageOrder?: unknown;
	layout?: unknown;
	recentModels?: unknown;
};

const ACCEPTED_UPDATE_KEYS = {
	theme: true,
	themeMode: true,
	systemThemePair: true,
	analyticsEnabled: true,
	analyticsConsentConfirmed: true,
	notificationsEnabled: true,
	terminalReplayKb: true,
	terminalWindowsShell: true,
	composerGrowthLimit: true,
	chatLineWidth: true,
	fileLineWidth: true,
	chatLineWidthBounded: true,
	fileLineWidthBounded: true,
	customLayoutPresets: true,
	favoriteModels: true,
	defaultModel: true,
	defaultEffort: true,
	reviewModel: true,
	reviewEffort: true,
	reviewAutoFix: true,
	agentReviewEnabled: true,
	subagentsEnabled: true,
	subagentMaxConcurrent: true,
	jbcentralQuotaEnabled: true,
	jbcentralQuotaRefreshSeconds: true,
	settleIdleDays: true,
	chatMessageOrder: true,
	layout: true,
	recentModels: true,
} satisfies Record<keyof RuntimeAppConfigUpdate, true>;

function assertUpdateShape(update: unknown): void {
	if (typeof update !== "object" || update === null || Array.isArray(update)) {
		throw new Error("settings update must be an object");
	}
	const unknownKey = Object.keys(update).find((key) => !Object.hasOwn(ACCEPTED_UPDATE_KEYS, key));
	if (unknownKey !== undefined) throw new Error(`Unknown setting: ${unknownKey}`);
}

function isWireModelRef(value: unknown): value is WireModel {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.provider === "string" &&
		record.provider.length > 0 &&
		typeof record.id === "string" &&
		record.id.length > 0 &&
		typeof record.name === "string" &&
		Array.isArray(record.thinkingLevels)
	);
}

function validateFavoriteModels(value: unknown): WireModel[] {
	if (!Array.isArray(value) || !value.every(isWireModelRef)) {
		throw new Error("favoriteModels must be a list of models");
	}
	return value.filter((model, index) => value.findIndex((m) => sameModel(m, model)) === index);
}

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
	assertUpdateShape(partial);
	const runtimeUpdate: RuntimeAppConfigUpdate = { ...partial };
	delete runtimeUpdate.chatMessageOrder;
	delete runtimeUpdate.layout;
	for (const [name, value] of [
		["chatLineWidth", runtimeUpdate.chatLineWidth],
		["fileLineWidth", runtimeUpdate.fileLineWidth],
	] as const) {
		if (value !== undefined && !isLineWidth(value)) {
			throw new Error(
				`${name} must be a whole number from ${LINE_WIDTH_COLUMNS.min} to ${LINE_WIDTH_COLUMNS.max}`,
			);
		}
	}
	for (const [name, value] of [
		["chatLineWidthBounded", runtimeUpdate.chatLineWidthBounded],
		["fileLineWidthBounded", runtimeUpdate.fileLineWidthBounded],
		["analyticsEnabled", runtimeUpdate.analyticsEnabled],
		["analyticsConsentConfirmed", runtimeUpdate.analyticsConsentConfirmed],
		["notificationsEnabled", runtimeUpdate.notificationsEnabled],
		["reviewAutoFix", runtimeUpdate.reviewAutoFix],
		["agentReviewEnabled", runtimeUpdate.agentReviewEnabled],
	] as const) {
		if (value !== undefined && typeof value !== "boolean") {
			throw new Error(`${name} must be a boolean`);
		}
	}
	if (
		runtimeUpdate.analyticsConsentConfirmed !== undefined &&
		runtimeUpdate.analyticsEnabled === undefined
	) {
		throw new Error("analytics consent must include the sharing preference");
	}
	const {
		defaultModel,
		defaultEffort,
		reviewModel,
		reviewEffort,
		favoriteModels,
		recentModels: _hostOwnedRecentModels,
		customLayoutPresets,
		subagentsEnabled,
		theme,
		themeMode,
		systemThemePair,
		jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds,
		...rest
	} = runtimeUpdate;
	for (const [name, value] of [
		["defaultModel", defaultModel],
		["reviewModel", reviewModel],
	] as const) {
		if (value !== undefined && value !== null && !isWireModelRef(value)) {
			throw new Error(`${name} must be a model or null`);
		}
	}
	if (subagentsEnabled !== undefined && typeof subagentsEnabled !== "boolean") {
		throw new Error("subagentsEnabled must be a boolean");
	}
	if (
		runtimeUpdate.subagentMaxConcurrent !== undefined &&
		!isSubagentMaxConcurrent(runtimeUpdate.subagentMaxConcurrent)
	) {
		throw new Error("subagentMaxConcurrent must be a whole number from 1 to 16");
	}
	if (jbcentralQuotaEnabled !== undefined && typeof jbcentralQuotaEnabled !== "boolean") {
		throw new Error("jbcentralQuotaEnabled must be a boolean");
	}
	if (
		runtimeUpdate.terminalWindowsShell !== undefined &&
		!isTerminalWindowsShell(runtimeUpdate.terminalWindowsShell)
	) {
		throw new Error("terminalWindowsShell must be auto, pwsh, powershell, or cmd");
	}
	if (
		runtimeUpdate.terminalReplayKb !== undefined &&
		!Number.isFinite(runtimeUpdate.terminalReplayKb)
	) {
		throw new Error("terminalReplayKb must be a finite number");
	}
	if (
		runtimeUpdate.composerGrowthLimit !== undefined &&
		!isComposerGrowthLimit(runtimeUpdate.composerGrowthLimit)
	) {
		throw new Error(`composerGrowthLimit must be one of ${COMPOSER_GROWTH_LIMITS.join(", ")}`);
	}
	if (
		jbcentralQuotaRefreshSeconds !== undefined &&
		!isJbcentralQuotaRefreshSeconds(jbcentralQuotaRefreshSeconds)
	) {
		throw new Error("jbcentralQuotaRefreshSeconds must be a whole number from 1 to 3600");
	}
	if (
		runtimeUpdate.settleIdleDays !== undefined &&
		!isSettleIdleDays(runtimeUpdate.settleIdleDays)
	) {
		throw new Error("settleIdleDays must be a whole number of days from 1 to 365, or null");
	}
	if (themeMode !== undefined && !isThemeMode(themeMode)) {
		throw new Error("themeMode must be fixed or system");
	}
	if (systemThemePair !== undefined && !isSystemThemePair(systemThemePair)) {
		throw new Error("systemThemePair must contain light and dark theme ids");
	}
	const current = getConfig();
	if (
		runtimeUpdate.analyticsEnabled === true &&
		!current.analyticsEnabled &&
		current.analyticsConsentConfirmed &&
		runtimeUpdate.analyticsConsentConfirmed === undefined
	) {
		throw new Error("enabling additional analytics requires an explicit confirmation");
	}
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
		...(favoriteModels === undefined
			? {}
			: { favoriteModels: validateFavoriteModels(favoriteModels) }),
	};
	if (defaultModel !== undefined) {
		if (defaultModel === null) delete next.defaultModel;
		else next.defaultModel = defaultModel;
	}
	if (defaultEffort !== undefined) {
		if (defaultEffort === null) delete next.defaultEffort;
		else next.defaultEffort = defaultEffort;
	}
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
	publishSettings?.(next, runtimeUpdate);
	return next;
}

/** Records an explicit model choice at the head of `recentModels` (deduped, capped), then publishes. */
export function noteRecentModel(model: WireModel): AppConfig {
	const current = getConfig();
	const recentModels = [
		model,
		...current.recentModels.filter((candidate) => !sameModel(candidate, model)),
	].slice(0, RECENT_MODELS_LIMIT);
	const next: AppConfig = { ...current, recentModels };
	saveConfig(next);
	cached = next;
	publishSettings?.(next, {});
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}
