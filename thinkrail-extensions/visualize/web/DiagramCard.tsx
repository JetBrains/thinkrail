import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { MermaidView } from "./MermaidView";

export function DiagramCard({ args, status }: ToolRenderProps) {
	const source = strArg(args, "mermaid");
	const title = strArg(args, "title");

	if (!source) {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? "Rendering…" : "(no diagram)"}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-diagram" className="flex flex-col gap-4">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<MermaidView source={source} title={title} />
		</div>
	);
}
