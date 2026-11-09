import { getToolRenderer } from "@thinkrail/chat-ui/toolRegistry";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";

/** A recorded call through the tool's registered renderer, without the chat's card, fold or interaction. */
export function ToolCallPreview(props: ToolRenderProps) {
	const Renderer = getToolRenderer(props.toolName);
	return <Renderer {...props} />;
}
