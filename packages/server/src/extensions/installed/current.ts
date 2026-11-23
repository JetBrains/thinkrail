import type { InstalledExtensions } from "./runtime";

let current: InstalledExtensions | undefined;

export function installedExtensions(): InstalledExtensions | undefined {
	return current;
}

export function setInstalledExtensions(runtime: InstalledExtensions | undefined): void {
	current = runtime;
}
