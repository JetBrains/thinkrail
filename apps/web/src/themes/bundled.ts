import { bundledThemeSources } from "@thinkrail/design-tokens";
import { buildThemeCatalog, installCachedUserThemes, installThemeCatalog } from "./runtime";

let initialized = false;

export function initializeThemes(): void {
	if (initialized) return;
	installThemeCatalog(buildThemeCatalog(bundledThemeSources()));
	installCachedUserThemes();
	initialized = true;
}
