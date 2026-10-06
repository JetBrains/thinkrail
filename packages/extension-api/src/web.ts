import type { ReactNode } from "react";

export { languageFromPath, numArg, resultText, strArg } from "./toolHelpers";
export {
	type ParsedToolResultContent,
	parseToolResultContent,
	toolValueText,
} from "./toolResultContent";

export type ToolStatus = "running" | "done" | "error";

export interface ToolRenderProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolStatus;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	streaming: boolean;
}

export type ToolChrome = "card" | "bare";

export type ToolProminence = "routine" | "primary";

export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

export type ToolSummary = (props: ToolRenderProps) => string;

export interface ToolRegistrationOptions {
	summary?: ToolSummary;
	chrome?: ToolChrome;
	prominence?: ToolProminence;
	defaultExpanded?: boolean;
}

export interface WebExtension {
	name: string;
	toolRenderers: Record<string, { renderer: ToolRenderer; options?: ToolRegistrationOptions }>;
}

export function defineWebExtension<T extends WebExtension>(extension: T): T {
	return extension;
}
