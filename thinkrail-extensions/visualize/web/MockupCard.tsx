import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { MockupView } from "./MockupView";
import { parseMockupDocuments, parseViewport } from "./mockup";

export function MockupCard({ args, status, resolveAsset }: ToolRenderProps) {
	const documents = parseMockupDocuments(args);
	const title = strArg(args, "title");

	if (documents.length === 0 || status === "running") {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? "Rendering mockup…" : "(no mockup)"}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-mockup" className="flex flex-col gap-4">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<MockupView
				documents={documents}
				title={title}
				viewport={parseViewport(args.viewport)}
				resolveAsset={resolveAsset}
			/>
		</div>
	);
}
