import { useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import type { ResourceViewProps } from "../../registry";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";
import { useHtmlViewport } from "./useHtmlViewport";
import { HtmlPreviewNotice } from "./ViewportSwitch";

export default function HtmlView({ resource, content, viewState, onViewState }: ResourceViewProps) {
	const t = useT();
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(() => buildHtmlPreviewDocument(text), [text]);
	const [viewport, selectViewport] = useHtmlViewport(viewState, onViewState);
	return (
		<div data-testid="html-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			<HtmlPreviewNotice viewport={viewport} onViewport={selectViewport} />
			<div className="min-h-0 flex-1 p-12">
				<HtmlFrame
					title={t("viewer.html.preview", { path: resource.path })}
					document={document}
					viewport={viewport}
				/>
			</div>
		</div>
	);
}
