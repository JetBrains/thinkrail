import { useMemo, useState } from "react";
import type { ResourceViewProps } from "../../registry";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";
import { HtmlPreviewNotice } from "./ViewportSwitch";
import { type HtmlViewport, htmlViewport } from "./viewport";

export default function HtmlView({ resource, content, viewState, onViewState }: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(() => buildHtmlPreviewDocument(text), [text]);
	const [viewport, setViewport] = useState<HtmlViewport>(() => htmlViewport(viewState));
	const selectViewport = (next: HtmlViewport) => {
		setViewport(next);
		onViewState?.({ viewport: next });
	};
	return (
		<div data-testid="html-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			<HtmlPreviewNotice viewport={viewport} onViewport={selectViewport} />
			<div className="min-h-0 flex-1 p-12">
				<HtmlFrame title={`Preview of ${resource.path}`} document={document} viewport={viewport} />
			</div>
		</div>
	);
}
