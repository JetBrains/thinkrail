import type { InstalledExtensions } from "./runtime";

let current: InstalledExtensions | undefined;

/** The host's installed-extension runtime; absent until the host starts one (and in most unit tests). */
export function installedExtensions(): InstalledExtensions | undefined {
	return current;
}

export function setInstalledExtensions(runtime: InstalledExtensions | undefined): void {
	current = runtime;
}
