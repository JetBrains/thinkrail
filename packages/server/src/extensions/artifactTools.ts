import type { ArtifactTool } from "@thinkrail/extension-api/server";
import type { ExtensionDisabled } from "./inline";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type ArtifactTools = ReadonlyMap<string, ArtifactTool>;

export function artifactTools(
	isDisabled: ExtensionDisabled,
	entries: readonly ServerExtensionEntry[] = serverExtensions(),
): ArtifactTools {
	const tools = new Map<string, ArtifactTool>();
	for (const { extension } of entries) {
		if (isDisabled(extension.name)) continue;
		for (const [name, tool] of Object.entries(extension.artifactTools ?? {})) {
			if (!tools.has(name)) tools.set(name, tool);
		}
	}
	return tools;
}
