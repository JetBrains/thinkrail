import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export interface ServerExtension {
	name: string;
	extensions: ExtensionFactory[];
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
