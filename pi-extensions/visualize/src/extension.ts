import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { comparisonMarkdown, mermaidFence } from "./markdown.ts";
import { probeRenderability } from "./probe.ts";
import { VisualizeSchema } from "./schema.ts";
import { renderVisualizeCall, renderVisualizeResult } from "./tui.ts";
import { mermaidSources, validateShape } from "./validate.ts";

export type MermaidValidator = (source: string) => void | Promise<void>;

export interface VisualizeExtensionOptions {
	validateMermaid?: MermaidValidator;
}

const DESCRIPTION =
	"Render a rich visualization in the UI instead of ASCII art or a plain markdown table. Two kinds, " +
	"chosen by `type`: 'diagram' renders a mermaid diagram (set `mermaid` to raw mermaid source of any " +
	"kind — flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt); 'comparison' " +
	"renders side-by-side option cards (set `options` to the alternatives, each with pros/cons, an " +
	"optional `recommended` flag, and an optional inline `mermaid`). Use for architecture and flow " +
	"diagrams and for weighing options or trade-offs.";

const PROMPT_SNIPPET =
	"Show diagrams (raw mermaid) and option comparisons as rich cards — prefer over ASCII art or markdown tables for architecture, flows, and trade-offs.";

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
			parameters: VisualizeSchema,
			async execute(_toolCallId, params) {
				validateShape(params);
				for (const { location, source } of mermaidSources(params)) {
					await validateMermaidAt(validate, location, source);
				}
				const text =
					params.type === "diagram"
						? mermaidFence(params.title, params.mermaid ?? "")
						: comparisonMarkdown(params.title, params.options ?? []);
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
