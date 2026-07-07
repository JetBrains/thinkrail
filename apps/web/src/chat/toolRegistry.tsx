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
	/** Absolute workspace/project root, when the host knows it, for rendering file paths relatively. */
	workspaceRoot?: string | undefined;
	/** True while the owning assistant message still streams — `args` may be incomplete. */
	streaming: boolean;
}

/**
 * How a tool's card is framed. `"card"` (default) = the shared collapsible `ToolCard` chrome (routine
 * calls fold away). `"bare"` = the renderer owns its whole frame, rendered full-width with no toggle — for
 * interactive/primary tools like `ask_user_question` whose questionnaire must stay open and prominent.
 */
export type ToolChrome = "card" | "bare";

/**
 * How much attention a tool's call deserves in the transcript. `"routine"` (the default, and what every
 * unregistered tool gets) folds into an activity group alongside neighboring routine steps; `"primary"`
 * escapes the fold and renders as its own row (output *for the user* — e.g. `visualize` — or an
 * interactive card). `"bare"` chrome implies primary: a renderer that owns its frame can't live inside a
 * fold's step rows.
 */
export type ToolProminence = "routine" | "primary";

/** A tool renderer returns the *body* of a tool card; the card chrome (header/status icon) is shared. */
export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

/**
 * A one-line summary shown in a tool card's header — the at-a-glance context (a bash command, a file
 * name) that lets a card stay collapsed by default without losing its meaning. Pure, derived from the
 * same props as the renderer. Optional: a tool without one collapses to just its name.
 */
export type ToolSummary = (props: ToolRenderProps) => string;

/** Presentation metadata a tool registers alongside its renderer. All optional — defaults are sensible. */
export interface ToolRegistrationOptions {
	/** One-line summary for collapsed card headers and activity-step rows (see {@link getToolSummary}). */
	summary?: ToolSummary;
	/** The card framing — `"card"` (default) or `"bare"` (see {@link ToolChrome}). */
	chrome?: ToolChrome;
	/** Attention level — `"routine"` (default; folds away) or `"primary"` (see {@link ToolProminence}). */
	prominence?: ToolProminence;
	/** A primary `"card"` tool renders expanded once complete (e.g. `visualize`). Default false. */
	defaultExpanded?: boolean;
}

interface ToolRegistration extends ToolRegistrationOptions {
	renderer: ToolRenderer;
}

const registry = new Map<string, ToolRegistration>();

/**
 * Register a renderer for a tool, keyed by the tool's name. THE extension point: a custom tool's UI is
 * added by calling this (e.g. `registerToolRenderer("bash", BashCard)`) — no core edits. Joined to the
 * agent side by tool name (a pi custom tool / extension provides the capability; this provides the UI).
 * `options` carries the presentation metadata: the collapsed-header `summary`, the `chrome` framing, and
 * the `prominence`/`defaultExpanded` attention defaults (read via {@link resolveProminence}).
 */
export function registerToolRenderer(
	toolName: string,
	renderer: ToolRenderer,
	options: ToolRegistrationOptions = {},
): void {
	registry.set(toolName, { renderer, ...options });
}

/** The renderer for a tool, or the default fallback when none is registered. */
export function getToolRenderer(toolName: string): ToolRenderer {
	return registry.get(toolName)?.renderer ?? DefaultToolRenderer;
}

/** The header summary for a tool, or "" when none is registered (card header is then just the name). */
export function getToolSummary(toolName: string, props: ToolRenderProps): string {
	return registry.get(toolName)?.summary?.(props) ?? "";
}

/** A tool's card chrome — `"card"` (default collapsible frame) unless registered as `"bare"`. */
export function getToolChrome(toolName: string): ToolChrome {
	return registry.get(toolName)?.chrome ?? "card";
}

/** A tool's resolved attention level: how it renders in the transcript. */
export interface ResolvedProminence {
	prominence: ToolProminence;
	/** Only meaningful for primary `"card"` tools: render expanded once the call completes. */
	defaultExpanded: boolean;
}

/**
 * The single seam every prominence read goes through (row derivation, `ToolCard`): registry-declared
 * defaults today, and where a per-user override map (settings) can plug in later without touching the
 * callers. Rules: unregistered/undeclared tools are `"routine"`; `"bare"` chrome implies `"primary"`
 * *unconditionally* — even over an explicit `prominence: "routine"` — because a self-framed renderer
 * can't fold into an activity group's step rows (a misregistration must not silently break the fold).
 */
export function resolveProminence(toolName: string): ResolvedProminence {
	const reg = registry.get(toolName);
	const prominence = reg?.chrome === "bare" ? "primary" : (reg?.prominence ?? "routine");
	return { prominence, defaultExpanded: reg?.defaultExpanded ?? false };
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
