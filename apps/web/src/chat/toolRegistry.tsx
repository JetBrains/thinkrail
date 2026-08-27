import type { ReactNode } from "react";
import { parseToolResultContent, toolValueText } from "./toolResultContent";
import type { ToolStatus } from "./types";

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

interface ToolRegistration extends ToolRegistrationOptions {
	renderer: ToolRenderer;
}

const registry = new Map<string, ToolRegistration>();

export function registerToolRenderer(
	toolName: string,
	renderer: ToolRenderer,
	options: ToolRegistrationOptions = {},
): void {
	registry.set(toolName, { renderer, ...options });
}

export function getToolRenderer(toolName: string): ToolRenderer {
	return registry.get(toolName)?.renderer ?? DefaultToolRenderer;
}

export function getToolSummary(toolName: string, props: ToolRenderProps): string {
	return registry.get(toolName)?.summary?.(props) ?? "";
}

export function getToolChrome(toolName: string): ToolChrome {
	return registry.get(toolName)?.chrome ?? "card";
}

export interface ResolvedProminence {
	prominence: ToolProminence;
	defaultExpanded: boolean;
}

export function resolveProminence(toolName: string): ResolvedProminence {
	const reg = registry.get(toolName);
	const prominence = reg?.chrome === "bare" ? "primary" : (reg?.prominence ?? "routine");
	return { prominence, defaultExpanded: reg?.defaultExpanded ?? false };
}

export function DefaultToolRenderer({ args, result, status }: ToolRenderProps): ReactNode {
	const argsText = toolValueText(args);
	const resultText = parseToolResultContent(result).text;
	return (
		<div className="flex flex-col gap-4">
			{argsText && argsText !== "{}" ? (
				<pre className="overflow-auto tr-code-text text-text-muted">{argsText}</pre>
			) : null}
			{status !== "running" && resultText ? (
				<pre className="overflow-auto tr-code-text text-text-default">{resultText}</pre>
			) : null}
		</div>
	);
}
