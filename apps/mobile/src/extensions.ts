import { registerToolRenderer } from "@thinkrail/chat-ui/toolRegistry";
import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import visualize from "@thinkrail/ext-visualize/web";
import type { WebExtension } from "@thinkrail/extension-api/web";

/** The extension tool cards the phone renders; the same web halves the IDE registers. */
export const phoneExtensions: readonly WebExtension[] = [visualize, askUserQuestion];

export function registerPhoneExtensions(): void {
	for (const extension of phoneExtensions) {
		for (const [name, { renderer, options }] of Object.entries(extension.toolRenderers)) {
			registerToolRenderer(name, renderer, options);
		}
	}
}
