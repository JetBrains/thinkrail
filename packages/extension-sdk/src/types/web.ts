import type { ToolRegistrationOptions, ToolRenderer } from "@thinkrail/extension-api/web";

export {
	type ComposerSuggestionsReader,
	numArg,
	resultText,
	strArg,
	type ToolChrome,
	type ToolInteraction,
	type ToolInteractionState,
	type ToolPlacement,
	type ToolProminence,
	type ToolRegistrationOptions,
	type ToolRenderer,
	type ToolRenderProps,
	type ToolStatus,
	type ToolSummary,
	type ToolWidth,
} from "@thinkrail/extension-api/web";

export interface WebExtension {
	name: string;
	toolRenderers: Record<string, { renderer: ToolRenderer; options?: ToolRegistrationOptions }>;
}

export declare function defineWebExtension<T extends WebExtension>(
	extension: T & Record<Exclude<keyof T, keyof WebExtension>, never>,
): T;
