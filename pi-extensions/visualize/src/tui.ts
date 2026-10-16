import {
	type AgentToolResult,
	getMarkdownTheme,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getCapabilities,
	hyperlink,
	Markdown,
	Text,
	TruncatedText,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { MermaidArt, Span } from "lovely-mermaid";
import { mermaidFence } from "./markdown.ts";
import { type MockupDocument, mockupDocuments } from "./mockup.ts";
import { mockupFileUrl, writeMockupFile } from "./mockupFile.ts";
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
	if (args?.type === "mockup") {
		return args.html === undefined && args.before !== undefined ? "before/after mockup" : "mockup";
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

function mockupParams(details: unknown): VisualizeParams | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const value = details as Partial<VisualizeParams>;
	const isText = (field: unknown) => field === undefined || typeof field === "string";
	if (value.type === "mockup") {
		return isText(value.html) && isText(value.before) && isText(value.after)
			? (value as VisualizeParams)
			: undefined;
	}
	if (value.type === "comparison" && Array.isArray(value.options)) {
		const valid = value.options.every(
			(option) =>
				typeof option === "object" &&
				option !== null &&
				typeof option.name === "string" &&
				isText(option.html),
		);
		return valid && value.options.some((option) => option.html !== undefined)
			? (value as VisualizeParams)
			: undefined;
	}
	return undefined;
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

type SavedMockup =
	| { document: MockupDocument; path: string }
	| { document: MockupDocument; error: string };

export class MockupLinksComponent implements Component {
	private readonly saved: SavedMockup[];
	private readonly lead: Markdown | undefined;
	private readonly title: string | undefined;
	private readonly viewport: string | undefined;

	constructor(
		params: VisualizeParams,
		leadText: string | undefined,
		cwd: string,
		private readonly expanded: boolean,
		private readonly theme: Theme,
		private readonly linked = getCapabilities().hyperlinks,
	) {
		this.lead = leadText ? markdown(leadText) : undefined;
		this.saved = mockupDocuments(params).map((document) => {
			try {
				return { document, path: writeMockupFile(document, cwd) };
			} catch (error) {
				return { document, error: error instanceof Error ? error.message : String(error) };
			}
		});
		this.title = params.type === "mockup" ? params.title : undefined;
		this.viewport = params.type === "mockup" ? (params.viewport ?? "desktop") : undefined;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.lead) lines.push(...this.lead.render(width), "");
		if (this.viewport) {
			const heading = `${this.title ?? "HTML mockup"} (${this.viewport})`;
			lines.push(truncateToWidth(this.theme.fg("toolTitle", this.theme.bold(heading)), width));
		}
		for (const entry of this.saved) {
			const name = entry.document.location === "html" ? "Mockup" : entry.document.label;
			const label = this.theme.fg("accent", this.theme.bold(`${name}:`));
			if ("error" in entry) {
				lines.push(
					...wrapTextWithAnsi(
						`${label} ${this.theme.fg("error", `couldn't save mockup — ${entry.error}`)}`,
						width,
					),
				);
				continue;
			}
			const target = this.linked
				? hyperlink(this.theme.fg("mdLink", "Open in browser ↗"), mockupFileUrl(entry.path))
				: this.theme.fg("muted", "open in a browser:");
			lines.push(truncateToWidth(`${label} ${target}`, width));
			lines.push(...wrapTextWithAnsi(this.theme.fg("dim", entry.path), width));
		}
		if (this.expanded) {
			for (const { document } of this.saved) {
				lines.push(
					"",
					...markdown(
						`**${document.label}**\n\n\`\`\`html\n${document.html.trim()}\n\`\`\``,
					).render(width),
				);
			}
		}
		return lines;
	}

	invalidate(): void {
		this.lead?.invalidate();
	}
}

export function renderVisualizeResult(
	result: AgentToolResult<unknown>,
	{ expanded, isPartial }: ToolRenderResultOptions,
	theme: Theme,
	context: { isError: boolean; cwd?: string },
): Component {
	if (isPartial) return new Text(theme.fg("warning", "Rendering…"), 0, 0);
	if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
	const diagram = diagramDetails(result.details);
	if (diagram) return new DiagramComponent(diagram.mermaid, diagram.title, expanded, theme);
	const mockup = mockupParams(result.details);
	if (mockup) {
		const lead = mockup.type === "comparison" ? resultText(result) : undefined;
		return new MockupLinksComponent(mockup, lead, context.cwd ?? process.cwd(), expanded, theme);
	}
	return markdown(resultText(result));
}
