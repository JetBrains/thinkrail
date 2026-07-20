import { buildThemeCatalog, installThemeCatalog } from "./runtime";

let initialized = false;

/** Discover, validate, and install the bundled JSON manifests synchronously during app bootstrap. */
export function initializeBundledThemes(): void {
	if (initialized) return;

	// Vite turns this into eager JSON imports: adding a bundled theme means adding one matching file —
	// there is no handwritten catalog to update. Keeping the glob inside this explicit initializer lets
	// Bun unit tests import the module without executing a Vite-only API.
	const bundled = import.meta.glob("./bundled/*.theme.json", {
		eager: true,
		import: "default",
	}) as Record<string, unknown>;

	installThemeCatalog(buildThemeCatalog(bundled));
	initialized = true;
}
