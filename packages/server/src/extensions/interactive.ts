import type { InteractiveTool } from "@thinkrail/extension-api/server";
import type { ExtensionDisabled } from "./inline";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type InteractiveTools = ReadonlyMap<string, InteractiveTool>;

export function interactiveTools(
	isDisabled: ExtensionDisabled,
	entries: readonly ServerExtensionEntry[] = serverExtensions,
): InteractiveTools {
	const tools = new Map<string, InteractiveTool>();
	for (const { extension } of entries) {
		if (isDisabled(extension.name)) continue;
		for (const [name, tool] of Object.entries(extension.interactiveTools ?? {})) {
			if (!tools.has(name)) tools.set(name, tool);
		}
	}
	return tools;
}
