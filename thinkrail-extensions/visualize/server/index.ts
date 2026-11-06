import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createVisualizeExtension } from "@thinkrail/pi-visualize";
import { mockupGuideline } from "./guidance";
import { strictMermaidValidator } from "./mermaid";
import { writeThemeFile } from "./themeFile";

export default defineServerExtension({
	name: "visualize",
	title: "Visualize",
	description:
		"Lets the agent draw Mermaid diagrams, side-by-side option comparisons, and rendered file previews or before/after mockups in chat.",
	extensions: [],
	sessionExtensions: (session) => {
		const { check, scratchDir } = session.workspaceFiles;
		const visualize = createVisualizeExtension({
			validateMermaid: strictMermaidValidator,
			checkFile: check,
			scratchDir,
			mockupGuideline: mockupGuideline(scratchDir),
		});
		return [
			(pi) => {
				visualize(pi);
				pi.on("before_agent_start", async (_event, ctx) => {
					await writeThemeFile({ cwd: ctx.cwd, scratchDir }).catch(() => undefined);
				});
			},
		];
	},
});
