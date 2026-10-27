import type { Translator } from "@thinkrail/locales/react";
import type { ReactNode } from "react";

export { languageFromPath, numArg, resultText, strArg } from "./toolHelpers";
export {
	type ParsedToolResultContent,
	parseToolResultContent,
	toolValueText,
} from "./toolResultContent";

export type ToolStatus = "running" | "done" | "error";

export interface ToolRevealOptions {
	block: "start" | "nearest";
	provenance: "automatic-attention" | "user-navigation";
	runway: "preserve" | "release";
	stability: "none" | "bounded";
	topInset?: number;
}

export interface ToolInteractionState<R = unknown> {
	response?: R | undefined;
	superseded: boolean;
	ended: boolean;
	accepting: boolean;
}

export interface ToolInteraction<R = unknown> {
	state: ToolInteractionState<R>;
	respond: (response: R) => Promise<void>;
	focusScope: object;
	prepareLayoutChange: (
		anchor: () => HTMLElement | null,
		provenance?: "user" | "automatic",
	) => () => void;
	revealElement: (element: HTMLElement, options: ToolRevealOptions) => void;
	cancelAutomaticReveal: () => void;
	focusComposer: () => void;
}

export interface ToolRenderProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolStatus;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	streaming: boolean;
	interaction?: ToolInteraction | undefined;
}

export type ToolChrome = "card" | "bare";

export type ToolProminence = "routine" | "primary";

export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

export type ToolSummary = (props: ToolRenderProps, t: Translator) => string;

export interface ToolRegistrationOptions {
	summary?: ToolSummary;
	chrome?: ToolChrome;
	prominence?: ToolProminence;
	defaultExpanded?: boolean;
	interactive?: boolean;
}

export interface WebExtension {
	name: string;
	toolRenderers: Record<string, { renderer: ToolRenderer; options?: ToolRegistrationOptions }>;
}

export function defineWebExtension<T extends WebExtension>(extension: T): T {
	return extension;
}
