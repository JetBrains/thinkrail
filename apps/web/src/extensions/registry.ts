import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import visualize from "@thinkrail/ext-visualize/web";
import type { ExtensionCommand, WebExtension } from "@thinkrail/extension-api/web";
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

export interface WebExtensionCommands {
	readonly extension: string;
	readonly enabled: boolean;
	readonly commands: readonly ExtensionCommand[];
}

export function webExtensionCommands(disabled: readonly string[]): WebExtensionCommands[] {
	return webExtensions.flatMap(({ name, commands }) =>
		commands ? [{ extension: name, enabled: !disabled.includes(name), commands }] : [],
	);
}

export function webOnlyExtensions(
	serverNames: ReadonlySet<string>,
): (WebExtension & { title: NonNullable<WebExtension["title"]> })[] {
	return webExtensions.flatMap((extension) => {
		const { title } = extension;
		const webOnly = title !== undefined && extension.toolRenderers === undefined;
		return webOnly && !serverNames.has(extension.name) ? [{ ...extension, title }] : [];
	});
}
