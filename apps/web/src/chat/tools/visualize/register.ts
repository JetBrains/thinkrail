import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { VisualizationCard } from "./VisualizationCard";

registerToolRenderer("visualize", VisualizationCard, {
	prominence: "primary",
	defaultExpanded: true,
	summary: ({ args }) => {
		const title = strArg(args, "title");
		if (title) return title;
		if (strArg(args, "type") === "comparison") {
			const count = Array.isArray(args.options) ? args.options.length : 0;
			return `comparison — ${count} option${count === 1 ? "" : "s"}`;
		}
		return "diagram";
	},
});
