import { defineWebExtension, strArg } from "@thinkrail/extension-api/web";
import { VisualizationCard } from "./VisualizationCard";

export { MermaidView } from "./MermaidView";
export { MockupView, type MockupViewProps } from "./MockupView";
export type { MockupViewport } from "./mockup";

export default defineWebExtension({
	name: "visualize",
	toolRenderers: {
		visualize: {
			renderer: VisualizationCard,
			options: {
				prominence: "primary",
				defaultExpanded: true,
				summary: ({ args }) => {
					const title = strArg(args, "title");
					if (title) return title;
					if (strArg(args, "type") === "comparison") {
						const count = Array.isArray(args.options) ? args.options.length : 0;
						return `comparison — ${count} option${count === 1 ? "" : "s"}`;
					}
					if (strArg(args, "type") === "mockup") {
						return !strArg(args, "html") && strArg(args, "before")
							? "before/after mockup"
							: "mockup";
					}
					return "diagram";
				},
			},
		},
	},
});
