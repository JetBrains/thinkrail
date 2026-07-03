import type { ReactNode } from "react";
import type { ToolStatus } from "./types";

/**
 * Props a tool renderer receives. `args` come from the pi `ToolCall`; `result` is the tool's output
 * (the pi event `result` / `partialResult`, typed `unknown` — narrow defensively).
 */
export interface ToolRenderProps {
	/** The pi tool call's id — lets an interactive renderer address its reply (e.g. `ask_user_question`). */
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolStatus;
	/** True while the owning assistant message still streams — `args` may be incomplete. */
	streaming: boolean;
}

/**
 * How a tool's card is framed. `"card"` (default) = the shared collapsible `ToolCard` chrome (routine
 * calls fold away). `"bare"` = the renderer owns its whole frame, rendered full-width with no toggle — for
 * interactive/primary tools like `ask_user_question` whose questionnaire must stay open and prominent.
 */
export type ToolChrome = "card" | "bare";

/** A tool renderer returns the *body* of a tool card; the card chrome (header/status icon) is shared. */
export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

/**
 * A one-line summary shown in a tool card's header — the at-a-glance context (a bash command, a file
 * name) that lets a card stay collapsed by default without losing its meaning. Pure, derived from the
 * same props as the renderer. Optional: a tool without one collapses to just its name.
 */
export type ToolSummary = (props: ToolRenderProps) => string;

const registry = new Map<string, ToolRenderer>();
const summaries = new Map<string, ToolSummary>();
const chromes = new Map<string, ToolChrome>();

/**
 * Register a renderer for a tool, keyed by the tool's name. THE extension point: a custom tool's UI is
 * added by calling this (e.g. `registerToolRenderer("bash", BashCard)`) — no core edits. Joined to the
 * agent side by tool name (a pi custom tool / extension provides the capability; this provides the UI).
 * The optional `summary` feeds the collapsed-by-default card header (see {@link getToolSummary}).
 */
export function registerToolRenderer(
	toolName: string,
	renderer: ToolRenderer,
	summary?: ToolSummary,
	chrome?: ToolChrome,
): void {
	registry.set(toolName, renderer);
	if (summary) summaries.set(toolName, summary);
	if (chrome) chromes.set(toolName, chrome);
}

/** The renderer for a tool, or the default fallback when none is registered. */
export function getToolRenderer(toolName: string): ToolRenderer {
	return registry.get(toolName) ?? DefaultToolRenderer;
}

/** The header summary for a tool, or "" when none is registered (card header is then just the name). */
export function getToolSummary(toolName: string, props: ToolRenderProps): string {
	return summaries.get(toolName)?.(props) ?? "";
}

/** A tool's card chrome — `"card"` (default collapsible frame) unless registered as `"bare"`. */
export function getToolChrome(toolName: string): ToolChrome {
	return chromes.get(toolName) ?? "card";
}

/** Best-effort text from a value of unknown shape (tool args/results are typed `any` on the wire). */
export function toText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** Fallback renderer: pretty-printed args, then the result once the tool finishes. */
export function DefaultToolRenderer({ args, result, status }: ToolRenderProps): ReactNode {
	const argsText = toText(args);
	const resultText = toText(result);
	return (
		<div className="flex flex-col gap-xs">
			{argsText && argsText !== "{}" ? (
				<pre className="overflow-auto font-[var(--font-mono)] text-[10px] text-muted">
					{argsText}
				</pre>
			) : null}
			{status !== "running" && resultText ? (
				<pre className="overflow-auto font-[var(--font-mono)] text-[10px] text-text">
					{resultText}
				</pre>
			) : null}
		</div>
	);
}
