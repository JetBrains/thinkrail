import type { InlineExtension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type RegistryExtensionKind = "extensions" | "childExtensions";
export type ExtensionDisabled = (name: string) => boolean;

const never: ExtensionDisabled = () => false;

function inlineNames(entry: ServerExtensionEntry, kind: RegistryExtensionKind): string[] {
	const factories = entry.extension[kind] ?? [];
	return factories.map((_, index) =>
		factories.length === 1 ? entry.extension.name : `${entry.extension.name}#${index + 1}`,
	);
}

export function registryInlineExtensions(
	kind: RegistryExtensionKind,
	isDisabled: ExtensionDisabled = never,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): InlineExtension[] {
	return entries.flatMap((entry) => {
		const factories = entry.extension[kind] ?? [];
		const names = inlineNames(entry, kind);
		return factories.map((factory, index) => ({
			name: names[index] ?? entry.extension.name,
			factory: async (pi) => {
				if (isDisabled(entry.extension.name)) return;
				await factory(pi);
			},
		}));
	});
}

export function omitDisabledRegistryExtensions(
	result: LoadExtensionsResult,
	isDisabled: ExtensionDisabled,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): LoadExtensionsResult {
	const omitted = new Set(
		entries
			.filter((entry) => isDisabled(entry.extension.name))
			.flatMap((entry) =>
				(["extensions", "childExtensions"] as const).flatMap((kind) =>
					inlineNames(entry, kind).map((name) => `<inline:${name}>`),
				),
			),
	);
	if (omitted.size === 0) return result;
	return {
		...result,
		extensions: result.extensions.filter((extension) => !omitted.has(extension.path)),
	};
}
