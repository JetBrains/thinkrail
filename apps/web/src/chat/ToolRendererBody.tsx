import { parseToolResultContent, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useMockupAssets } from "./mockupAssets";
import { ToolResultImages } from "./ToolResultImages";
import { getToolRenderer } from "./toolRegistry";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const Renderer = getToolRenderer(props.toolName);
	const resolveAsset = useMockupAssets();
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			<Renderer resolveAsset={resolveAsset} {...props} />
			<ToolResultImages images={images} label={imageLabel || `${props.toolName} image output`} />
		</>
	);
}
