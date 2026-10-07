import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { serverExtensions } from "./registry";

export type RegistryExtensionKind = "extensions" | "childExtensions";

export function registryInlineExtensions(kind: RegistryExtensionKind): InlineExtension[] {
	return serverExtensions.flatMap(({ extension }) => {
		const factories = extension[kind] ?? [];
		return factories.map((factory, index) => ({
			name: factories.length === 1 ? extension.name : `${extension.name}#${index + 1}`,
			factory,
		}));
	});
}
