import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export interface ServerExtension {
	name: string;
	/** Display copy for the Settings catalog; `name` stays the identity. */
	title?: string;
	description?: string;
	extensions: ExtensionFactory[];
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
