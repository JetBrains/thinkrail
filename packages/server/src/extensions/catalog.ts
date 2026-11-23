import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry, ExtensionSettingDescriptor } from "@thinkrail/contracts";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import {
	dropAnswer,
	extensionSessionServices,
	type HostSessionServices,
	isFactoryList,
	settlesWithinLoadTimeout,
} from "./inline";
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
	await settlesWithinLoadTimeout(
		Promise.resolve().then(() => factory(recorder as ExtensionAPI)),
	).catch(() => false);
	return [...tools];
}

const inertSession: HostSessionServices = {
	expectToolResponse: () => {},
	awaitToolResponse: () => Promise.reject(new Error("the Settings catalog has no session")),
	workspaceFiles: {
		check: () => Promise.reject(new Error("the Settings catalog has no workspace")),
		checkArtifacts: () => Promise.reject(new Error("the Settings catalog has no workspace")),
		ensureArtifactsDir: () => Promise.reject(new Error("the Settings catalog has no workspace")),
		scratchDir: "",
		artifactsDir: "",
	},
};

type ExtensionDescription = Omit<ExtensionCatalogEntry, "enabled">;

function inertSessionFactories(extension: ServerExtension): ExtensionFactory[] {
	try {
		const factories = extension.sessionExtensions?.(
			extensionSessionServices(extension, inertSession),
		);
		if (isFactoryList(factories)) return factories;
		dropAnswer(factories);
		return [];
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
		hasParentExtensions:
			extension.extensions.length > 0 || extension.sessionExtensions !== undefined,
		hasChildExtensions: (extension.childExtensions?.length ?? 0) > 0,
		...(settings.length > 0 ? { settings } : {}),
		...(extension.apiVersion === undefined ? {} : { apiVersion: extension.apiVersion }),
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

let hostFactories: readonly ExtensionFactory[] = [];
let hostFactoryTools: Promise<string[]> | undefined;

/** The host's own inline factories, whose tool names an installed extension never owns. */
export function setHostToolFactories(factories: readonly ExtensionFactory[]): void {
	hostFactories = factories;
	hostFactoryTools = undefined;
}

async function hostToolNames(builtins: readonly ServerExtensionEntry[]): Promise<Set<string>> {
	hostFactoryTools ??= Promise.all(hostFactories.map(recordToolNames)).then((names) =>
		names.flat(),
	);
	const described = await Promise.all(builtins.map(({ extension }) => describeOnce(extension)));
	return new Set([...described.flatMap(({ tools }) => tools), ...(await hostFactoryTools)]);
}

/** An installed server half's tool names split into the ones it owns and the ones the host keeps. */
export async function extensionToolNames(
	extension: ServerExtension,
	builtins: readonly ServerExtensionEntry[] = builtinServerExtensions,
): Promise<{ tools: string[]; shadowed: string[] }> {
	const [{ tools }, host] = await Promise.all([describeOnce(extension), hostToolNames(builtins)]);
	return {
		tools: tools.filter((name) => !host.has(name)),
		shadowed: tools.filter((name) => host.has(name)),
	};
}

async function installedEntry(
	record: InstalledExtensionRecord,
	disabled: ReadonlySet<string>,
	builtins: readonly ServerExtensionEntry[],
): Promise<ExtensionCatalogEntry> {
	const server = record.server ? await describeOnce(record.server.extension) : undefined;
	const owned = record.server
		? await extensionToolNames(record.server.extension, builtins)
		: undefined;
	const title = record.manifest?.title ?? server?.title ?? record.title;
	const description = record.description ?? server?.description;
	const half = webHalfOf(record);
	const web = half && owned?.shadowed.length ? { ...half, shadowed: owned.shadowed } : half;
	return {
		tools: [],
		hasParentExtensions: false,
		hasChildExtensions: false,
		...server,
		...(owned ? { tools: owned.tools } : {}),
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
		...(record.manifest?.api ? { api: record.manifest.api } : {}),
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
		...(await Promise.all(installed.map((record) => installedEntry(record, disabled, entries)))),
	];
}
