import { parseToolResultContent, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { ToolRendererBoundary } from "./ToolRendererBoundary";
import { ToolResultImages } from "./ToolResultImages";
import { useToolInteraction } from "./toolInteraction";
import { DefaultToolRenderer, useToolRenderer } from "./toolRegistry";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const t = useT();
	const Renderer = useToolRenderer(props.toolName);
	const interaction = useToolInteraction(props.toolCallId, props.toolName);
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			<ToolRendererBoundary
				renderer={Renderer}
				toolCallId={props.toolCallId}
				status={props.status}
				streaming={props.streaming}
				fallback={
					<div data-testid="tool-renderer-fallback">
						<DefaultToolRenderer {...props} />
					</div>
				}
			>
				<Renderer {...props} interaction={props.interaction ?? interaction} />
			</ToolRendererBoundary>
			<ToolResultImages
				images={images}
				label={imageLabel || t("chat.toolImages.fallbackLabel", { tool: props.toolName })}
			/>
		</>
	);
}
