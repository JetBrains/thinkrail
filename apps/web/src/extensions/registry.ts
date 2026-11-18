import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import hintMode from "@thinkrail/ext-hint-mode/web";
import nextSteps from "@thinkrail/ext-next-steps/web";
import sessionInsights from "@thinkrail/ext-session-insights/web";
import visualize from "@thinkrail/ext-visualize/web";
import type {
	ExtensionCommand,
	PanelDeclaration,
	WebExtension,
} from "@thinkrail/extension-api/web";
import { registerToolRenderer } from "../chat/toolRegistry";

export const webExtensions: readonly WebExtension[] = [
	visualize,
	askUserQuestion,
	hintMode,
	nextSteps,
	sessionInsights,
];

export interface RegisteredPanel {
	extension: string;
	panel: string;
	declaration: PanelDeclaration;
}

export function registerWebExtensions(): void {
	for (const extension of webExtensions) {
		for (const [name, { renderer, options }] of Object.entries(extension.toolRenderers ?? {})) {
			registerToolRenderer(name, renderer, options, extension.name);
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

/** The translated-title key the web half of `name` declares, for any row that names the extension. */
export function webExtensionTitle(name: string): WebExtension["title"] {
	return webExtensions.find((extension) => extension.name === name)?.title;
}

export function webOnlyExtensions(
	serverNames: ReadonlySet<string>,
): (WebExtension & { title: NonNullable<WebExtension["title"]> })[] {
	return webExtensions.flatMap((extension) => {
		const { title } = extension;
		const webOnly =
			title !== undefined &&
			extension.toolRenderers === undefined &&
			extension.panels === undefined;
		return webOnly && !serverNames.has(extension.name) ? [{ ...extension, title }] : [];
	});
}

function collectPanels(extensions: readonly WebExtension[]): readonly RegisteredPanel[] {
	return extensions.flatMap((extension) =>
		Object.entries(extension.panels ?? {}).map(([panel, declaration]) => ({
			extension: extension.name,
			panel,
			declaration,
		})),
	);
}

const registeredPanels = collectPanels(webExtensions);

export function extensionPanels(extensions?: readonly WebExtension[]): readonly RegisteredPanel[] {
	return extensions ? collectPanels(extensions) : registeredPanels;
}

export function findExtensionPanel(
	extension: string,
	panel: string,
	extensions?: readonly WebExtension[],
): RegisteredPanel | undefined {
	return extensionPanels(extensions).find(
		(candidate) => candidate.extension === extension && candidate.panel === panel,
	);
}
