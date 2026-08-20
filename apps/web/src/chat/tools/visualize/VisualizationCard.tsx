import type { ToolRenderProps } from "../../toolRegistry";
import { resultText, strArg } from "../toolHelpers";
import { ComparisonCard } from "./ComparisonCard";
import { DiagramCard } from "./DiagramCard";

export function VisualizationCard(props: ToolRenderProps) {
	const { args, result, status } = props;

	if (status === "error") {
		return (
			<div data-testid="tool-visualize" data-status="error" className="flex flex-col gap-xs">
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">
					{resultText(result) || "Visualization failed."}
				</pre>
			</div>
		);
	}

	const type = strArg(args, "type");
	return (
		<div data-testid="tool-visualize" data-status={status}>
			{type === "comparison" ? <ComparisonCard {...props} /> : <DiagramCard {...props} />}
		</div>
	);
}
