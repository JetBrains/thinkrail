import { parseToolResultContent, type ToolRenderProps } from "@thinkrail/extension-api/web";
import {
	ResourceHostProvider,
	type ResourceScope,
	useOptionalResourceHost,
} from "@thinkrail/resource-renderers";
import { type ReactNode, useMemo } from "react";
import { useChatActions } from "./ChatActions";
import { ToolResultImages } from "./ToolResultImages";
import { getToolRenderer } from "./toolRegistry";

export function ToolRendererBody({
	imageLabel,
	...props
}: ToolRenderProps & { imageLabel: string }) {
	const Renderer = getToolRenderer(props.toolName);
	const resourceScope = useChatActions()?.resourceScope;
	const images = props.status === "running" ? [] : parseToolResultContent(props.result).images;
	return (
		<>
			{resourceScope ? (
				<ChatResourceScope scope={resourceScope}>
					<Renderer {...props} />
				</ChatResourceScope>
			) : (
				<Renderer {...props} />
			)}
			<ToolResultImages images={images} label={imageLabel || `${props.toolName} image output`} />
		</>
	);
}

function ChatResourceScope({ scope, children }: { scope: ResourceScope; children: ReactNode }) {
	const host = useOptionalResourceHost();
	const scoped = useMemo(() => (host ? { ...host, scope } : null), [host, scope]);
	return scoped ? <ResourceHostProvider value={scoped}>{children}</ResourceHostProvider> : children;
}
