import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createVisualizeExtension } from "@thinkrail.ai/pi-visualize";
import { strictMermaidValidator } from "./mermaid";

export default defineServerExtension({
	name: "visualize",
	title: "Visualize",
	description: "Lets the agent draw Mermaid diagrams and side-by-side option comparisons in chat.",
	extensions: [createVisualizeExtension({ validateMermaid: strictMermaidValidator })],
});
