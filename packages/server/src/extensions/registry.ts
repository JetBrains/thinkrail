import askUserQuestion from "@thinkrail/ext-ask-user-question/server";
import nextSteps from "@thinkrail/ext-next-steps/server";
import visualize from "@thinkrail/ext-visualize/server";
import webAccess from "@thinkrail/ext-web-access/server";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import { type InstalledServerExtension, installedExtensions } from "./installed";

export interface ServerExtensionEntry {
	/** A built-in's public server specifier; an installed extension's absolute entry file. */
	readonly specifier: string;
	readonly extension: ServerExtension;
	/** Present for an installed extension: the skill roots its loader resolved from the entry. */
	readonly installed?: { readonly skillRoots: readonly string[] };
}

export const builtinServerExtensions: readonly ServerExtensionEntry[] = [
	{ specifier: "@thinkrail/ext-visualize/server", extension: visualize },
	{ specifier: "@thinkrail/ext-ask-user-question/server", extension: askUserQuestion },
	{ specifier: "@thinkrail/ext-web-access/server", extension: webAccess },
	{ specifier: "@thinkrail/ext-next-steps/server", extension: nextSteps },
];

const installedEntries = new WeakMap<InstalledServerExtension, ServerExtensionEntry>();
let current: {
	servers: readonly InstalledServerExtension[];
	entries: readonly ServerExtensionEntry[];
} = { servers: [], entries: builtinServerExtensions };

function entryOf(server: InstalledServerExtension): ServerExtensionEntry {
	let entry = installedEntries.get(server);
	if (!entry) {
		entry = {
			specifier: server.entry,
			extension: server.extension,
			installed: { skillRoots: server.skillRoots },
		};
		installedEntries.set(server, entry);
	}
	return entry;
}

/** Built-ins first, then the loaded installed extensions; the same array until that set changes. */
export function serverExtensions(): readonly ServerExtensionEntry[] {
	const servers = installedExtensions()?.servers() ?? [];
	if (servers !== current.servers) {
		current = {
			servers,
			entries:
				servers.length === 0
					? builtinServerExtensions
					: [...builtinServerExtensions, ...servers.map(entryOf)],
		};
	}
	return current.entries;
}
