import type { ResourceViewProps } from "../../registry";
import { isInteractiveHtmlPath } from "./interactive";
import { HtmlPreview } from "./View";

export default function InteractiveHtmlView(props: ResourceViewProps) {
	return <HtmlPreview {...props} interactive={isInteractiveHtmlPath(props.resource.path)} />;
}
