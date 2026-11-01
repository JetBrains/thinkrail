import {
	applyPalette,
	assertThemeManifest,
	bundledThemeSources,
	type ThemeAppearance,
	type ThemeManifest,
} from "@thinkrail/design-tokens";

const SYSTEM_PAIR: Record<ThemeAppearance, string> = { dark: "dark", light: "light" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function followSystemTheme(): () => void {
	const manifests = new Map<string, ThemeManifest>();
	for (const source of Object.values(bundledThemeSources())) {
		const manifest = assertThemeManifest(source);
		manifests.set(manifest.id, manifest);
	}
	const media = window.matchMedia(DARK_QUERY);
	const apply = (): void => {
		const manifest = manifests.get(SYSTEM_PAIR[media.matches ? "dark" : "light"]);
		if (!manifest) return;
		const root = document.documentElement;
		applyPalette(root, manifest);
		root.dataset.themeContrast = manifest.contrast;
		root.dataset.theme = manifest.id;
	};
	apply();
	media.addEventListener("change", apply);
	return () => media.removeEventListener("change", apply);
}
