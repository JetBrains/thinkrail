import {
	type AgentToolResult,
	getMarkdownTheme,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, Text, visibleWidth } from "@earendil-works/pi-tui";
import { mermaidFence } from "./markdown.ts";
import { renderBoxDrawing } from "./probe.ts";
import type { VisualizeParams } from "./schema.ts";

export function callSummary(args: Partial<VisualizeParams> | undefined): string {
	if (args?.title) return args.title;
	if (args?.type === "comparison") {
		const count = Array.isArray(args.options) ? args.options.length : 0;
		return `comparison — ${count} option${count === 1 ? "" : "s"}`;
	}
	return "diagram";
}

export function renderVisualizeCall(args: VisualizeParams, theme: Theme): Component {
	return new Text(
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
	return lines.every((line) => {
		const cells = visibleWidth(line);
		return cells <= width && cells === line.length;
	});
}

export class DiagramComponent implements Component {
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private drawing: string[] | undefined | null = null;

	constructor(
		private readonly source: string,
		private readonly title: string | undefined,
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}

	private boxDrawing(): string[] | undefined {
		if (this.drawing === null) {
			let rendered: string | undefined;
			try {
				rendered = renderBoxDrawing(this.source);
			} catch {
				rendered = undefined;
			}
			this.drawing = rendered?.split("\n").map((line) => line.trimEnd());
		}
		return this.drawing;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		if (this.title) {
			lines.push(this.theme.fg("toolTitle", this.theme.bold(this.title)), "");
		}
		const drawing = this.boxDrawing();
		const fence = markdown(mermaidFence(undefined, this.source));
		if (drawing && fitsWidth(drawing, width)) {
			lines.push(...drawing.map((line) => this.theme.fg("toolOutput", line)));
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
