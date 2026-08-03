import type { ToolRenderProps } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { MermaidView } from "./MermaidView";

/** Body for `visualize` type="diagram": an optional title + the mermaid diagram (from `args.mermaid`). */
export function DiagramCard({ args, status }: ToolRenderProps) {
	const source = strArg(args, "mermaid");
	const title = strArg(args, "title");

	if (!source) {
		return (
			<span className="text-text-subtle tr-text-metadata italic">
				{status === "running" ? "Rendering…" : "(no diagram)"}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-diagram" className="flex flex-col gap-xs">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<MermaidView source={source} title={title} />
		</div>
	);
}
