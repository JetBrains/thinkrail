import { buildThemeCatalog, installCachedUserThemes, installThemeCatalog } from "./runtime";

let initialized = false;

export function initializeThemes(): void {
	if (initialized) return;

	const bundled = import.meta.glob("./bundled/*.theme.json", {
		eager: true,
		import: "default",
	});

	installThemeCatalog(buildThemeCatalog(bundled));
	installCachedUserThemes();
	initialized = true;
}
