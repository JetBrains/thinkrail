import { useMemo } from "react";
import type { ResourceViewProps } from "@/resources";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";

export default function HtmlView({ resource, content }: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(() => buildHtmlPreviewDocument(text), [text]);
	return (
		<div data-testid="html-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			<div
				data-testid="html-disabled-notice"
				className="shrink-0 border-border-default border-b bg-feedback-info-subtle px-12 py-8 tr-text-metadata text-feedback-info"
			>
				Scripts and external resources are disabled.
			</div>
			<div className="min-h-0 flex-1 p-12">
				<HtmlFrame title={`Preview of ${resource.path}`} document={document} />
			</div>
		</div>
	);
}
