import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import visualize from "@thinkrail/ext-visualize/web";
import type { WebExtension } from "@thinkrail/extension-api/web";
import { registerToolRenderer } from "../chat/toolRegistry";

export const webExtensions: readonly WebExtension[] = [visualize, askUserQuestion, hintMode];

export function registerWebExtensions(): void {
	for (const extension of webExtensions) {
		for (const [name, { renderer, options }] of Object.entries(extension.toolRenderers ?? {})) {
			registerToolRenderer(name, renderer, options);
		}
	}
}

export function enabledWebExtensions(disabled: readonly string[]): WebExtension[] {
	return webExtensions.filter((extension) => !disabled.includes(extension.name));
}

export function webOnlyExtensions(
	serverNames: ReadonlySet<string>,
): (WebExtension & { title: NonNullable<WebExtension["title"]> })[] {
	return webExtensions.flatMap((extension) => {
		const { title } = extension;
		return title !== undefined && !serverNames.has(extension.name) ? [{ ...extension, title }] : [];
	});
}
