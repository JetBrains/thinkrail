import type {
	ExtensionFactory,
	InlineExtension,
	LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type RegistryExtensionKind = "extensions" | "childExtensions";
export type ExtensionDisabled = (name: string) => boolean;

const never: ExtensionDisabled = () => false;

function factoriesOf(
	entry: ServerExtensionEntry,
	kind: RegistryExtensionKind,
	session: ExtensionSessionServices | undefined,
): ExtensionFactory[] {
	const { extension } = entry;
	if (kind === "childExtensions") return extension.childExtensions ?? [];
	const perSession =
		session && extension.sessionExtensions ? extension.sessionExtensions(session) : [];
	return [...extension.extensions, ...perSession];
}

export function registryInlineExtensions(
	kind: RegistryExtensionKind,
	isDisabled: ExtensionDisabled = never,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
	session?: ExtensionSessionServices,
): InlineExtension[] {
	return entries.flatMap((entry) => {
		const { name } = entry.extension;
		const factories = factoriesOf(entry, kind, session);
		return factories.map((factory, index) => ({
			name: factories.length === 1 ? name : `${name}#${index + 1}`,
			factory: async (pi) => {
				if (isDisabled(name)) return;
				await factory(pi);
			},
		}));
	});
}

export function registryExtensionName(
	path: string,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): string | undefined {
	const match = /^<inline:([^#>]+)(?:#\d+)?>$/.exec(path);
	if (!match) return undefined;
	return entries.find((entry) => entry.extension.name === match[1])?.extension.name;
}

export function omitDisabledRegistryExtensions(
	result: LoadExtensionsResult,
	isDisabled: ExtensionDisabled,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): LoadExtensionsResult {
	const kept = result.extensions.filter((extension) => {
		const name = registryExtensionName(extension.path, entries);
		return name === undefined || !isDisabled(name);
	});
	return kept.length === result.extensions.length ? result : { ...result, extensions: kept };
}

export function preferRegistryTools(
	result: LoadExtensionsResult,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): LoadExtensionsResult {
	const isRegistry = (path: string) => registryExtensionName(path, entries) !== undefined;
	const ordered = [...result.extensions];
	for (const ours of result.extensions) {
		if (!isRegistry(ours.path)) continue;
		const at = ordered.indexOf(ours);
		const rival = ordered.findIndex(
			(other, index) =>
				index < at &&
				!isRegistry(other.path) &&
				[...other.tools.keys()].some((name) => ours.tools.has(name)),
		);
		if (rival < 0) continue;
		ordered.splice(at, 1);
		ordered.splice(rival, 0, ours);
	}
	return ordered.every((extension, index) => extension === result.extensions[index])
		? result
		: { ...result, extensions: ordered };
}
