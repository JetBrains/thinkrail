import type { ResourceDiffProps } from "../../registry";
import { HtmlComparison } from "./Diff";
import { isInteractiveHtmlPath } from "./interactive";

export default function InteractiveHtmlDiff(props: ResourceDiffProps) {
	return <HtmlComparison {...props} interactive={isInteractiveHtmlPath} />;
}
