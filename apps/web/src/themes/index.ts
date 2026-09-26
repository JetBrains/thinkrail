export { initializeBundledThemes } from "./bundled";
export type { ThemeOverlay, ThemeOverlayResult } from "./overlay";
export {
	applyTheme,
	applyThemePreference,
	deriveSystemThemePair,
	getThemes,
	onSystemAppearanceChange,
	readSystemAppearance,
	readThemeHint,
	readThemeOverlayHint,
	resolveTheme,
	resolveThemePreference,
	setThemeOverlay,
	type ThemeDescriptor,
	type ThemeOverlayHint,
	type ThemePreference,
	type ThemeResolution,
	writeThemeHint,
	writeThemeOverlayHint,
} from "./runtime";
export type { ThemeManifest } from "./schema";
export { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "./shiki";
export { onThemeSwap, type ThemeSwapOptions } from "./swap";
