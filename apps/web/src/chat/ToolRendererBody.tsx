import { parseToolResultContent, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { ToolResultImages } from "./ToolResultImages";
import { useToolInteraction } from "./toolInteraction";
import { getToolRenderer } from "./toolRegistry";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const t = useT();
	const Renderer = getToolRenderer(props.toolName);
	const interaction = useToolInteraction(props.toolCallId, props.toolName);
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			<Renderer {...props} interaction={props.interaction ?? interaction} />
			<ToolResultImages
				images={images}
				label={imageLabel || t("chat.toolImages.fallbackLabel", { tool: props.toolName })}
			/>
		</>
	);
}
