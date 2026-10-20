import { parseToolResultContent, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { ToolResultImages } from "./ToolResultImages";
import { getToolRenderer } from "./toolRegistry";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const Renderer = getToolRenderer(props.toolName);
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			<Renderer {...props} />
			<ToolResultImages images={images} label={imageLabel || `${props.toolName} image output`} />
		</>
	);
}
