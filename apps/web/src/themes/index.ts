export { initializeThemes } from "./bundled";
export { resolveThinkrailEditorTheme } from "./editor";
export { THINKRAIL_PIERRE_THEME } from "./pierre";
export {
	applyTheme,
	applyThemePreference,
	clearUserThemes,
	deriveSystemThemePair,
	getThemes,
	getUserThemeIssues,
	installUserThemes,
	onSystemAppearanceChange,
	onThemesChange,
	readSystemAppearance,
	readThemeHint,
	resolveTheme,
	resolveThemePreference,
	type ThemeDescriptor,
	type ThemePreference,
	type ThemeResolution,
	type UserThemeIssue,
	writeThemeHint,
} from "./runtime";
export type { ThemeManifest } from "./schema";
