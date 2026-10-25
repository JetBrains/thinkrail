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
