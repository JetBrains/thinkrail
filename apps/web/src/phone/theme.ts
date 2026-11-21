import type { ThemeAppearance } from "@thinkrail/design-tokens";
import { BUNDLED_LOCALES, resolveLocale } from "@thinkrail/locales";
import { applyLocale } from "@thinkrail/locales/react";
import {
	applyTheme,
	initializeThemes,
	onSystemAppearanceChange,
	readSystemAppearance,
} from "../themes";
import type { DevicePreferences } from "./preferences";

/** The bundled theme a device preference names under the OS's current appearance. */
export function deviceThemeId(
	preferences: Pick<DevicePreferences, "theme" | "contrast">,
	system: ThemeAppearance,
): string {
	const appearance = preferences.theme === "system" ? system : preferences.theme;
	return preferences.contrast === "high" ? `high-contrast-${appearance}` : appearance;
}

/** Applies the phone's own theme and language, following the OS while either is set to System; returns the unsubscribe. */
export function applyDevicePreferences(preferences: DevicePreferences): () => void {
	initializeThemes();
	const applyLanguage = (): void => {
		const tag = resolveLocale(preferences.locale, BUNDLED_LOCALES, navigator.languages);
		void applyLocale(tag, {});
		document.documentElement.lang = tag;
	};
	applyTheme(deviceThemeId(preferences, readSystemAppearance()));
	applyLanguage();
	const stopFollowingTheme = onSystemAppearanceChange((system) =>
		applyTheme(deviceThemeId(preferences, system)),
	);
	window.addEventListener("languagechange", applyLanguage);
	return () => {
		stopFollowingTheme();
		window.removeEventListener("languagechange", applyLanguage);
	};
}
