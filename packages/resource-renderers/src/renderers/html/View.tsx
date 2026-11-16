import { useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import { useResourceEnvironment } from "../../host";
import type { ResourceViewProps } from "../../registry";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument, buildInteractiveHtmlDocument } from "./htmlDocument";
import { useHtmlViewport } from "./useHtmlViewport";
import { HtmlPreviewNotice } from "./ViewportSwitch";

export function HtmlPreview({
	resource,
	content,
	viewState,
	onViewState,
	interactive,
}: ResourceViewProps & { interactive: boolean }) {
	const t = useT();
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(
		() => (interactive ? buildInteractiveHtmlDocument(text) : buildHtmlPreviewDocument(text)),
		[text, interactive],
	);
	const [viewport, selectViewport] = useHtmlViewport(viewState, onViewState);
	const compact = useResourceEnvironment().compact ?? false;
	return (
		<div data-testid="html-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			<HtmlPreviewNotice
				viewport={viewport}
				onViewport={selectViewport}
				interactive={interactive}
			/>
			<div className="min-h-0 flex-1 p-12">
				<HtmlFrame
					title={t("viewer.html.preview", { path: resource.path })}
					document={document}
					viewport={viewport}
					compact={compact}
					interactive={interactive}
				/>
			</div>
		</div>
	);
}

export default function HtmlView(props: ResourceViewProps) {
	return <HtmlPreview {...props} interactive={false} />;
}
