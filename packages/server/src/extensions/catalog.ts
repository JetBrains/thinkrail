import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry, ExtensionSettingDescriptor } from "@thinkrail/contracts";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import { extensionSessionServices, type HostSessionServices, isFactoryList } from "./inline";
import { type InstalledExtensionRecord, installedExtensions, webHalfOf } from "./installed";
import { builtinServerExtensions, type ServerExtensionEntry } from "./registry";

const inert: unknown = new Proxy(() => inert, {
	get: (_target, key) => (key === "then" ? undefined : inert),
	apply: () => inert,
});

async function recordToolNames(factory: ExtensionFactory): Promise<string[]> {
	const tools: string[] = [];
	const recorder = new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === "registerTool") return (tool: { name: string }) => tools.push(tool.name);
				return key === "then" ? undefined : inert;
			},
		},
	);
	await Promise.resolve()
		.then(() => factory(recorder as ExtensionAPI))
		.catch(() => undefined);
	return tools;
}

const inertSession: HostSessionServices = {
	expectToolResponse: () => {},
	awaitToolResponse: () => Promise.reject(new Error("the Settings catalog has no session")),
	workspaceFiles: {
		check: () => Promise.reject(new Error("the Settings catalog has no workspace")),
		scratchDir: "",
	},
};

type ExtensionDescription = Omit<ExtensionCatalogEntry, "enabled">;

function inertSessionFactories(extension: ServerExtension): ExtensionFactory[] {
	try {
		const factories = extension.sessionExtensions?.(
			extensionSessionServices(extension, inertSession),
		);
		return isFactoryList(factories) ? factories : [];
	} catch {
		return [];
	}
}

async function describe(extension: ServerExtension): Promise<ExtensionDescription> {
	const factories = [...extension.extensions, ...inertSessionFactories(extension)];
	const tools = (await Promise.all(factories.map(recordToolNames))).flat();
	const settings = Object.entries(extension.settings ?? {}).map(
		([key, setting]): ExtensionSettingDescriptor => ({
			key,
			default: setting.default,
			...(setting.title ? { title: setting.title } : {}),
			...(setting.description ? { description: setting.description } : {}),
		}),
	);
	return {
		name: extension.name,
		title: extension.title ?? extension.name,
		...(extension.description ? { description: extension.description } : {}),
		tools: [...new Set(tools)],
		hasChildExtensions: (extension.childExtensions?.length ?? 0) > 0,
		...(settings.length > 0 ? { settings } : {}),
	};
}

const described = new WeakMap<ServerExtension, Promise<ExtensionDescription>>();

function describeOnce(extension: ServerExtension): Promise<ExtensionDescription> {
	let description = described.get(extension);
	if (!description) {
		description = describe(extension);
		described.set(extension, description);
	}
	return description;
}

async function installedEntry(
	record: InstalledExtensionRecord,
	disabled: ReadonlySet<string>,
): Promise<ExtensionCatalogEntry> {
	const server = record.server ? await describeOnce(record.server.extension) : undefined;
	const title = record.manifest?.title ?? server?.title ?? record.title;
	const description = record.description ?? server?.description;
	const web = webHalfOf(record);
	return {
		tools: [],
		hasChildExtensions: false,
		...server,
		name: record.name,
		title,
		...(description ? { description } : {}),
		enabled: !disabled.has(record.name),
		kind: "installed",
		source: record.source,
		...(record.version ? { version: record.version } : {}),
		state: record.state,
		...(record.error ? { error: record.error } : {}),
		...(web ? { web } : {}),
	};
}

/** The Settings catalog: built-ins in registry order, then every installed declaration with its state. */
export async function listExtensionCatalog(
	disabled: ReadonlySet<string>,
	entries: readonly ServerExtensionEntry[] = builtinServerExtensions,
	installed: readonly InstalledExtensionRecord[] = installedExtensions()?.records() ?? [],
): Promise<ExtensionCatalogEntry[]> {
	const builtins = await Promise.all(
		entries.map(async ({ extension }) => ({
			...(await describeOnce(extension)),
			enabled: !disabled.has(extension.name),
			kind: "builtin" as const,
		})),
	);
	return [
		...builtins,
		...(await Promise.all(installed.map((record) => installedEntry(record, disabled)))),
	];
}
