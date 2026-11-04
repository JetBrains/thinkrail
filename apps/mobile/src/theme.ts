import {
	applyPalette,
	assertThemeManifest,
	bundledThemeSources,
	type ThemeManifest,
} from "@thinkrail/design-tokens";
import { BUNDLED_LOCALES, resolveLocale } from "@thinkrail/locales";
import { applyLocale } from "@thinkrail/locales/react";
import type { DevicePreferences } from "./preferences";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const manifests = new Map<string, ThemeManifest>(
	Object.values(bundledThemeSources()).map((source) => {
		const manifest = assertThemeManifest(source);
		return [manifest.id, manifest];
	}),
);

/** Applies the phone's own theme and language, following the OS while either is set to System; returns the unsubscribe. */
export function applyDevicePreferences(preferences: DevicePreferences): () => void {
	const media = window.matchMedia(DARK_QUERY);
	const applyTheme = (): void => {
		const appearance =
			preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
		const id = preferences.contrast === "high" ? `high-contrast-${appearance}` : appearance;
		const manifest = manifests.get(id);
		if (!manifest) return;
		const root = document.documentElement;
		applyPalette(root, manifest);
		root.dataset.themeContrast = manifest.contrast;
		root.dataset.theme = manifest.id;
	};
	const applyLanguage = (): void => {
		const tag = resolveLocale(preferences.locale, BUNDLED_LOCALES, navigator.languages);
		applyLocale(tag, {});
		document.documentElement.lang = tag;
	};
	applyTheme();
	applyLanguage();
	media.addEventListener("change", applyTheme);
	window.addEventListener("languagechange", applyLanguage);
	return () => {
		media.removeEventListener("change", applyTheme);
		window.removeEventListener("languagechange", applyLanguage);
	};
}
