import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { comparisonMarkdown, fileMarkdown, mermaidFence } from "./markdown.ts";
import { probeRenderability } from "./probe.ts";
import { type VisualizeParams, VisualizeSchema } from "./schema.ts";
import { renderVisualizeCall, renderVisualizeResult } from "./tui.ts";
import { fileSources, mermaidSources, validateShape } from "./validate.ts";

export type MermaidValidator = (source: string) => void | Promise<void>;

export type FileChecker = (path: string, cwd: string) => void | Promise<void>;

export interface VisualizeExtensionOptions {
	validateMermaid?: MermaidValidator;
	checkFile?: FileChecker;
	scratchDir?: string;
}

const DESCRIPTION =
	"Render a rich visualization in the UI instead of ASCII art or a plain markdown table. Two kinds, " +
	"chosen by `type`: 'diagram' renders a mermaid diagram (set `mermaid` to raw mermaid source of any " +
	"kind — flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt); 'comparison' " +
	"renders side-by-side option cards (set `options` to the alternatives, each with pros/cons, an " +
	"optional `recommended` flag, and an optional inline `mermaid`); 'file' renders an existing " +
	"workspace file by its type (set `path`; HTML, Markdown, SVG, CSV, JSON, notebooks, images, PDF, " +
	"code), or a before/after diff of two files when `before` is set. Use for architecture and flow " +
	"diagrams, for weighing options or trade-offs, and for showing UI mockups.";

const PROMPT_SNIPPET =
	"Show diagrams (raw mermaid), option comparisons, and files/mockups (rendered, or before/after) as rich cards — prefer over ASCII art or markdown tables for architecture, flows, trade-offs, and UI proposals.";

function promptGuidelines(scratchDir: string | undefined): string[] {
	const where = scratchDir
		? `under \`${scratchDir}\``
		: "in a scratch location outside version control";
	return [
		`When you propose or ask about a visual/UI change, write a self-contained HTML mockup ${where} (inline CSS and data: images only — hosts may strip scripts, form controls and external resources, so draw buttons and inputs with styled elements) and show it with visualize type 'file'; set \`before\` to a mockup of the current UI to show the change.`,
	];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function validateMermaidAt(
	validate: MermaidValidator,
	location: string,
	source: string,
): Promise<void> {
	if (source.trim() === "") {
		throw new Error(
			`visualize: invalid Mermaid syntax in \`${location}\`: the diagram source is empty.\nProvide mermaid source and call \`visualize\` again.`,
		);
	}
	try {
		await validate(source);
	} catch (error) {
		throw new Error(
			`visualize: invalid Mermaid syntax in \`${location}\`: ${errorMessage(error)}\nCorrect the syntax and call \`visualize\` again.`,
		);
	}
}

async function checkFileAt(
	check: FileChecker,
	location: string,
	path: string,
	cwd: string,
): Promise<void> {
	try {
		await check(path, cwd);
	} catch (error) {
		throw new Error(
			`visualize: cannot show \`${location}\` (${path}): ${errorMessage(error)}\nWrite the file first, then call \`visualize\` again.`,
		);
	}
}

function resultMarkdown(params: VisualizeParams): string {
	if (params.type === "diagram") return mermaidFence(params.title, params.mermaid ?? "");
	if (params.type === "file") return fileMarkdown(params);
	return comparisonMarkdown(params.title, params.options ?? []);
}

export function createVisualizeExtension(
	options: VisualizeExtensionOptions = {},
): ExtensionFactory {
	const validate = options.validateMermaid ?? probeRenderability;
	const { checkFile } = options;
	return (pi: ExtensionAPI): void => {
		pi.registerTool({
			name: "visualize",
			label: "Visualize",
			description: DESCRIPTION,
			promptSnippet: PROMPT_SNIPPET,
			promptGuidelines: promptGuidelines(options.scratchDir),
			parameters: VisualizeSchema,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				validateShape(params);
				for (const { location, source } of mermaidSources(params)) {
					await validateMermaidAt(validate, location, source);
				}
				if (checkFile) {
					for (const { location, path } of fileSources(params)) {
						await checkFileAt(checkFile, location, path, ctx.cwd);
					}
				}
				const text = resultMarkdown(params);
				return {
					content: [{ type: "text", text }],
					details: params,
				};
			},
			renderCall: renderVisualizeCall,
			renderResult: renderVisualizeResult,
		});
	};
}
