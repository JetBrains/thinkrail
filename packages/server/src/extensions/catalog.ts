import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

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

const inertSession: ExtensionSessionServices = {
	expectToolResponse: () => {},
	awaitToolResponse: () => Promise.reject(new Error("the Settings catalog has no session")),
};

type ExtensionDescription = Omit<ExtensionCatalogEntry, "enabled">;

async function describeEntry(entry: ServerExtensionEntry): Promise<ExtensionDescription> {
	const { extension } = entry;
	const factories = [
		...extension.extensions,
		...(extension.sessionExtensions?.(inertSession) ?? []),
	];
	const tools = (await Promise.all(factories.map(recordToolNames))).flat();
	return {
		name: extension.name,
		title: extension.title ?? extension.name,
		...(extension.description ? { description: extension.description } : {}),
		tools: [...new Set(tools)],
		hasChildExtensions: (extension.childExtensions?.length ?? 0) > 0,
	};
}

const described = new WeakMap<readonly ServerExtensionEntry[], Promise<ExtensionDescription[]>>();

export async function listExtensionCatalog(
	disabled: ReadonlySet<string>,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): Promise<ExtensionCatalogEntry[]> {
	let descriptions = described.get(entries);
	if (!descriptions) {
		descriptions = Promise.all(entries.map(describeEntry));
		described.set(entries, descriptions);
	}
	return (await descriptions).map((description) => ({
		...description,
		enabled: !disabled.has(description.name),
	}));
}
