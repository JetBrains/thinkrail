import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import visualize from "@thinkrail/ext-visualize/web";
import type { WebExtension } from "@thinkrail/extension-api/web";
import { registerToolRenderer } from "../chat/toolRegistry";

export const webExtensions: readonly WebExtension[] = [visualize, askUserQuestion];

export function registerWebExtensions(): void {
	for (const extension of webExtensions) {
		for (const [name, { renderer, options }] of Object.entries(extension.toolRenderers)) {
			registerToolRenderer(name, renderer, options);
		}
	}
}
