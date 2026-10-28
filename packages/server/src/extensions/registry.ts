import askUserQuestion from "@thinkrail/ext-ask-user-question/server";
import visualize from "@thinkrail/ext-visualize/server";
import webAccess from "@thinkrail/ext-web-access/server";
import type { ServerExtension } from "@thinkrail/extension-api/server";

export interface ServerExtensionEntry {
	readonly specifier: string;
	readonly extension: ServerExtension;
}

export const serverExtensions: readonly ServerExtensionEntry[] = [
	{ specifier: "@thinkrail/ext-visualize/server", extension: visualize },
	{ specifier: "@thinkrail/ext-ask-user-question/server", extension: askUserQuestion },
	{ specifier: "@thinkrail/ext-web-access/server", extension: webAccess },
];
