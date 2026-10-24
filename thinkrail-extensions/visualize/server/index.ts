import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createVisualizeExtension } from "@thinkrail/pi-visualize";
import { MOCKUP_DIR, workspaceFileChecker } from "./files";
import { strictMermaidValidator } from "./mermaid";

export default defineServerExtension({
	name: "visualize",
	title: "Visualize",
	description:
		"Lets the agent draw Mermaid diagrams, side-by-side option comparisons, and rendered file previews or before/after mockups in chat.",
	extensions: [
		createVisualizeExtension({
			validateMermaid: strictMermaidValidator,
			checkFile: workspaceFileChecker,
			scratchDir: MOCKUP_DIR,
		}),
	],
});
