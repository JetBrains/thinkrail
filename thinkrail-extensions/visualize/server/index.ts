import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createVisualizeExtension } from "@thinkrail.ai/pi-visualize";
import { strictMermaidValidator } from "./mermaid";

export default defineServerExtension({
	name: "visualize",
	extensions: [createVisualizeExtension({ validateMermaid: strictMermaidValidator })],
});
