import type { ToolRenderProps } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { MermaidView } from "./MermaidView";

/** Body for `visualize` type="diagram": an optional title + the mermaid diagram (from `args.mermaid`). */
export function DiagramCard({ args, status }: ToolRenderProps) {
	const source = strArg(args, "mermaid");
	const title = strArg(args, "title");

	if (!source) {
		return (
			<span className="text-hint text-xs italic">
				{status === "running" ? "Rendering…" : "(no diagram)"}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-diagram" className="flex flex-col gap-xs">
			{title ? <div className="font-medium text-sm text-text">{title}</div> : null}
			<MermaidView source={source} title={title} />
		</div>
	);
}
