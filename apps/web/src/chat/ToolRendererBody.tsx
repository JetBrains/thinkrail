import { ToolResultImages } from "./ToolResultImages";
import { type ToolRenderProps, useToolRenderer } from "./toolRegistry";
import { parseToolResultContent } from "./toolResultContent";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const Renderer = useToolRenderer(props.toolName);
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			<Renderer {...props} />
			<ToolResultImages images={images} label={imageLabel || `${props.toolName} image output`} />
		</>
	);
}
