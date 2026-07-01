import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { comparisonMarkdown, mermaidFence } from "./src/markdown.ts";
import { VisualizeSchema } from "./src/schema.ts";
import { validateShape } from "./src/validate.ts";

const DESCRIPTION =
	"Render a rich visualization in the UI instead of ASCII art or a plain markdown table. Two kinds, " +
	"chosen by `type`: 'diagram' renders a mermaid diagram (set `mermaid` to raw mermaid source of any " +
	"kind — flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt); 'comparison' " +
	"renders side-by-side option cards (set `options` to the alternatives, each with pros/cons, an " +
	"optional `recommended` flag, and an optional inline `mermaid`). Use for architecture and flow " +
	"diagrams and for weighing options or trade-offs.";

const PROMPT_SNIPPET =
	"Show diagrams (raw mermaid) and option comparisons as rich cards — prefer over ASCII art or markdown tables for architecture, flows, and trade-offs.";

/**
 * pi extension entry. Registers the `visualize` tool. The tool's only work is to validate the shape and
 * build a markdown fallback (`content`); rich rendering happens in host-specific renderers keyed to the
 * tool name. Pure display — no side effects.
 */
export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "visualize",
		label: "Visualize",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		parameters: VisualizeSchema,
		async execute(_toolCallId, params) {
			validateShape(params);
			const text =
				params.type === "diagram"
					? mermaidFence(params.title, params.mermaid ?? "")
					: comparisonMarkdown(params.title, params.options ?? []);
			return {
				content: [{ type: "text", text }],
				details: params,
			};
		},
	});
}
