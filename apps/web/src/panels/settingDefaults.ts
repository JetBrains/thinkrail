import { type AppConfig, type AppConfigUpdate, DEFAULT_CONFIG } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { DEFAULT_CHAT_MESSAGE_ORDER } from "@/chat/chatPreferences";
import type { SettingsReset } from "@/settingsKit";
import { CLIENT_PREFERENCE_DEFAULTS, DEFAULT_LOCAL_LAYOUT_PREFERENCES, useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";

export const CLEARABLE_CONFIG_KEYS = [
	"defaultModel",
	"defaultEffort",
	"reviewModel",
	"reviewEffort",
	"worktreeDirectory",
] as const;

type ClearableConfigKey = (typeof CLEARABLE_CONFIG_KEYS)[number];

type StoreState = ReturnType<typeof useAppStore.getState>;

export type ValueConfigKey = Extract<
	keyof StoreState & keyof AppConfig,
	| "analyticsEnabled"
	| "notificationsEnabled"
	| "terminalReplayKb"
	| "terminalWindowsShell"
	| "composerGrowthLimit"
	| "questionPanelHeight"
	| "chatLineWidth"
	| "fileLineWidth"
	| "chatLineWidthBounded"
	| "fileLineWidthBounded"
	| "voiceInputEnabled"
	| "reviewAutoFix"
	| "reviewAutoFixRounds"
	| "agentReviewEnabled"
	| "subagentsEnabled"
	| "subagentMaxConcurrent"
	| "jbcentralQuotaEnabled"
	| "jbcentralQuotaRefreshSeconds"
	| "settleIdleDays"
	| "projectsFolder"
	| "locale"
	| "interfaceFont"
	| "codeFont"
	| "codeFontSize"
	| "codeLigatures"
	| "fontWeightOffset"
>;

export type ResettableConfigKey = ValueConfigKey | ClearableConfigKey;

const isClearable = (key: ResettableConfigKey): key is ClearableConfigKey =>
	CLEARABLE_CONFIG_KEYS.some((clearable) => clearable === key);

function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every(
			(key) => Object.hasOwn(b, key) && sameValue(Reflect.get(a, key), Reflect.get(b, key)),
		)
	);
}

export function isConfigDefault<K extends ResettableConfigKey>(
	key: K,
	value: AppConfig[K] | undefined,
): boolean {
	return isClearable(key) ? value === undefined : sameValue(value, DEFAULT_CONFIG[key]);
}

export function configResetPatch(key: ResettableConfigKey): AppConfigUpdate {
	return isClearable(key) ? { [key]: null } : { [key]: DEFAULT_CONFIG[key] };
}

export const THEME_RESET_PATCH = {
	themeMode: DEFAULT_CONFIG.themeMode,
	theme: DEFAULT_CONFIG.theme,
} as const satisfies AppConfigUpdate;

export function useConfigReset(key: ResettableConfigKey, failure: MessageKey): SettingsReset {
	const t = useT();
	const value = useAppStore((state) => state[key]);
	return {
		changed: !isConfigDefault(key, value),
		onReset: () => void saveSettings(configResetPatch(key), t(failure)),
	};
}

const CLIENT_DEFAULTS = {
	...CLIENT_PREFERENCE_DEFAULTS,
	chatMessageOrder: DEFAULT_CHAT_MESSAGE_ORDER,
} as const;

export type ClientPreferenceKey = keyof typeof CLIENT_DEFAULTS;

function resetClientPreference(key: ClientPreferenceKey): void {
	const state = useAppStore.getState();
	if (key === "doubleShiftSearch") state.setDoubleShiftSearch(CLIENT_DEFAULTS.doubleShiftSearch);
	else if (key === "markdownOutlineSide") {
		state.setMarkdownOutlineSide(CLIENT_DEFAULTS.markdownOutlineSide);
	} else state.setChatMessageOrder(CLIENT_DEFAULTS.chatMessageOrder);
}

export function isClientPreferenceDefault(key: ClientPreferenceKey, value: unknown): boolean {
	return value === CLIENT_DEFAULTS[key];
}

export function useClientPreferenceReset(key: ClientPreferenceKey): SettingsReset {
	const value = useAppStore((state) => state[key]);
	return {
		changed: !isClientPreferenceDefault(key, value),
		onReset: () => resetClientPreference(key),
	};
}

export type LayoutLimitKey = "maxSideGroups" | "maxBottomGroups";

export function useLayoutLimitReset(key: LayoutLimitKey): SettingsReset {
	const value = useAppStore((state) => state.localLayoutPreferences[key]);
	return {
		changed: value !== DEFAULT_LOCAL_LAYOUT_PREFERENCES[key],
		onReset: () => {
			const state = useAppStore.getState();
			state.setLocalLayoutPreferences({
				...state.localLayoutPreferences,
				[key]: DEFAULT_LOCAL_LAYOUT_PREFERENCES[key],
			});
		},
	};
}
