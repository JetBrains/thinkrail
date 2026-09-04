export { initializeBundledThemes } from "./bundled";
export {
	applyTheme,
	applyThemePreference,
	deriveSystemThemePair,
	getThemes,
	onSystemAppearanceChange,
	onThemeSwap,
	readSystemAppearance,
	readThemeHint,
	resolveTheme,
	resolveThemePreference,
	type ThemeDescriptor,
	type ThemePreference,
	type ThemeResolution,
	writeThemeHint,
} from "./runtime";
export type { ThemeManifest } from "./schema";
export { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "./shiki";
