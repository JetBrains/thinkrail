// Registers the `visualize` renderer, joined to the bundled `pi-visualize` extension by tool name.
// Imported for its side effect by `tools/register` (which `ChatView` imports once on mount).
import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { VisualizationCard } from "./VisualizationCard";

// Collapsed-card header summary: the title, else a type-derived label.
registerToolRenderer("visualize", VisualizationCard, ({ args }) => {
	const title = strArg(args, "title");
	if (title) return title;
	if (strArg(args, "type") === "comparison") {
		const count = Array.isArray(args.options) ? args.options.length : 0;
		return `comparison — ${count} option${count === 1 ? "" : "s"}`;
	}
	return "diagram";
});
