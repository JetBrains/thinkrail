import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { comparisonMarkdown, mermaidFence } from "./markdown.ts";
import { mockupDocuments, mockupNotes, mockupSummary, validateMockupDocument } from "./mockup.ts";
import { probeRenderability } from "./probe.ts";
import { VisualizeSchema } from "./schema.ts";
import { renderVisualizeCall, renderVisualizeResult } from "./tui.ts";
import { mermaidSources, validateShape } from "./validate.ts";

export type MermaidValidator = (source: string) => void | Promise<void>;

export interface VisualizeExtensionOptions {
	validateMermaid?: MermaidValidator;
}

const DESCRIPTION =
	"Render a rich visualization in the UI instead of ASCII art or a plain markdown table. Three kinds, " +
	"chosen by `type`: 'diagram' renders a mermaid diagram (set `mermaid` to raw mermaid source of any " +
	"kind — flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt); 'comparison' " +
	"renders side-by-side option cards (set `options` to the alternatives, each with pros/cons, an " +
	"optional `recommended` flag, an optional inline `mermaid`, and an optional `html` mockup); " +
	"'mockup' renders a static HTML/CSS UI mockup (set `html`, or `before` and `after` to contrast the " +
	"current and proposed UI, plus an optional `viewport`). Use for architecture and flow diagrams, for " +
	"weighing options or trade-offs, and to show any visible UI change before building it.";

const PROMPT_SNIPPET =
	"Show diagrams (raw mermaid), option comparisons, and static HTML UI mockups (single or before/after) as rich cards — prefer over ASCII art, markdown tables, or prose descriptions of UI.";

const PROMPT_GUIDELINES = [
	"Whenever you propose, or ask the user to choose, a visible UI change, show it with `visualize` type 'mockup' (or a 'comparison' whose options carry `html`) before building it; use `before` + `after` when changing an existing screen.",
	"For a mockup, choose fidelity per question: a plain grayscale wireframe for layout and structure, or the project's real colors, fonts and spacing (copied from its CSS) for visual decisions.",
	"Mockup HTML is static and self-contained: inline <style>, no scripts, inline SVG or data: URLs or workspace-relative paths for images; show only the area that changes plus enough context to place it.",
];

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

export function createVisualizeExtension(
	options: VisualizeExtensionOptions = {},
): ExtensionFactory {
	const validate = options.validateMermaid ?? probeRenderability;
	return (pi: ExtensionAPI): void => {
		pi.registerTool({
			name: "visualize",
			label: "Visualize",
			description: DESCRIPTION,
			promptSnippet: PROMPT_SNIPPET,
			promptGuidelines: PROMPT_GUIDELINES,
			parameters: VisualizeSchema,
			async execute(_toolCallId, params) {
				validateShape(params);
				for (const { location, source } of mermaidSources(params)) {
					await validateMermaidAt(validate, location, source);
				}
				const documents = mockupDocuments(params);
				for (const document of documents) validateMockupDocument(document);
				const body =
					params.type === "diagram"
						? mermaidFence(params.title, params.mermaid ?? "")
						: params.type === "mockup"
							? mockupSummary(params)
							: comparisonMarkdown(params.title, params.options ?? []);
				const notes = documents.flatMap(mockupNotes);
				const text =
					notes.length === 0 ? body : `${body}\n\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}`;
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
