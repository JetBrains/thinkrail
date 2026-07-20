import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { hasTheme, registerTheme } from "./runtime";

let initialized = false;

/** Register every bundled JSON manifest synchronously during app bootstrap. */
export function initializeBundledThemes(): void {
	if (initialized) return;

	// Vite turns this into eager JSON imports. Adding a bundled theme means adding one matching file—there
	// is no handwritten catalog to update. Every value still crosses the same untrusted registration
	// boundary a future extension loader will use. Keeping the glob inside this explicit initializer lets
	// Bun unit tests import the registry barrel without trying to execute a Vite-only API.
	const bundled = import.meta.glob("./bundled/*.theme.json", {
		eager: true,
		import: "default",
	}) as Record<string, unknown>;

	for (const [path, candidate] of Object.entries(bundled).sort(([a], [b]) => a.localeCompare(b))) {
		try {
			registerTheme(candidate);
		} catch (error) {
			console.error(`Ignoring invalid bundled theme ${path}`, error);
		}
	}

	if (!hasTheme(DEFAULT_CONFIG.theme)) {
		throw new Error(`The configured default theme is missing or invalid: ${DEFAULT_CONFIG.theme}`);
	}
	initialized = true;
}
