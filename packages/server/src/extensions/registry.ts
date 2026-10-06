import type { ServerExtension } from "@thinkrail/extension-api/server";
import visualize from "@thinkrail/ext-visualize/server";

export interface ServerExtensionEntry {
	readonly specifier: string;
	readonly extension: ServerExtension;
}

export const serverExtensions: readonly ServerExtensionEntry[] = [
	{ specifier: "@thinkrail/ext-visualize/server", extension: visualize },
];
