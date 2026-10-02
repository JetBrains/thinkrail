import {
	type AgentToolResult,
	getMarkdownTheme,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Markdown,
	Text,
	TruncatedText,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { MermaidArt, Span } from "lovely-mermaid";
import { mermaidFence } from "./markdown.ts";
import { renderArt } from "./probe.ts";
import type { VisualizeParams } from "./schema.ts";

type ThemeColor = Parameters<Theme["fg"]>[0];

const ROLE_COLORS = {
	border: "borderMuted",
	text: "text",
	edge: "accent",
	edgeLabel: "muted",
} as const satisfies Record<string, ThemeColor>;

export function callSummary(args: Partial<VisualizeParams> | undefined): string {
	if (args?.title) return args.title;
	if (args?.type === "comparison") {
		const count = Array.isArray(args.options) ? args.options.length : 0;
		return `comparison — ${count} option${count === 1 ? "" : "s"}`;
	}
	return "diagram";
}

export function renderVisualizeCall(args: VisualizeParams, theme: Theme): Component {
	return new TruncatedText(
		theme.fg("toolTitle", theme.bold("visualize ")) + theme.fg("accent", callSummary(args)),
		0,
		0,
	);
}

function resultText(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function diagramDetails(details: unknown): { title?: string; mermaid: string } | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const value = details as Partial<VisualizeParams>;
	if (value.type !== "diagram" || typeof value.mermaid !== "string") return undefined;
	return value.title === undefined
		? { mermaid: value.mermaid }
		: { title: value.title, mermaid: value.mermaid };
}

function markdown(text: string): Markdown {
	return new Markdown(text, 0, 0, getMarkdownTheme());
}

export function fitsWidth(lines: readonly string[], width: number): boolean {
	return lines.every((line) => visibleWidth(line) <= width);
}

function paint(span: Span, theme: Theme): string {
	if (span.role === "none") return span.text;
	if (span.role === "title") return theme.fg("accent", theme.bold(span.text));
	return theme.fg(ROLE_COLORS[span.role], span.text);
}

export class DiagramComponent implements Component {
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private art: MermaidArt | undefined | null = null;

	constructor(
		private readonly source: string,
		private readonly title: string | undefined,
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}

	private completeArt(): MermaidArt | undefined {
		if (this.art === null) {
			const art = renderArt(this.source);
			this.art = art && art.warnings.length === 0 ? art : undefined;
		}
		return this.art;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		if (this.title) {
			lines.push(
				truncateToWidth(this.theme.fg("toolTitle", this.theme.bold(this.title)), width),
				"",
			);
		}
		const art = this.completeArt();
		const fence = markdown(mermaidFence(undefined, this.source));
		if (art && fitsWidth(art.plain, width)) {
			lines.push(...art.styled.map((row) => row.map((span) => paint(span, this.theme)).join("")));
			if (this.expanded) lines.push("", ...fence.render(width));
		} else {
			lines.push(...fence.render(width));
		}
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}
}

export function renderVisualizeResult(
	result: AgentToolResult<unknown>,
	{ expanded, isPartial }: ToolRenderResultOptions,
	theme: Theme,
	context: { isError: boolean },
): Component {
	if (isPartial) return new Text(theme.fg("warning", "Rendering…"), 0, 0);
	if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
	const diagram = diagramDetails(result.details);
	if (diagram) return new DiagramComponent(diagram.mermaid, diagram.title, expanded, theme);
	return markdown(resultText(result));
}
