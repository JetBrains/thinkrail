import { useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";
import { useHtmlViewport } from "./useHtmlViewport";
import { HtmlPreviewNotice } from "./ViewportSwitch";
import type { HtmlViewport } from "./viewport";

function textOf(content: ResourceContent): string | null {
	return content.kind === "text" ? content.text : null;
}

function HtmlSide({
	text,
	title,
	viewport,
}: {
	text: string;
	title: string;
	viewport: HtmlViewport;
}) {
	const document = useMemo(() => buildHtmlPreviewDocument(text), [text]);
	return <HtmlFrame title={title} document={document} viewport={viewport} />;
}

export default function HtmlDiff({
	resource,
	originalResource = resource,
	original,
	modified,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const t = useT();
	const noDocument = t("viewer.html.noDocument");
	const [viewport, selectViewport] = useHtmlViewport(viewState, onViewState);
	const originalText = textOf(original);
	const modifiedText = textOf(modified);
	const originalSide: VisualDiffSide = {
		present: originalText !== null,
		content:
			originalText === null ? null : (
				<HtmlSide
					text={originalText}
					title={t("viewer.html.originalPreview", { path: originalResource.path })}
					viewport={viewport}
				/>
			),
		caption:
			originalText === null
				? t("viewer.side.oldCaption", { detail: noDocument })
				: t("viewer.html.oldDocument"),
		intrinsicSize: null,
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedText !== null,
		content:
			modifiedText === null ? null : (
				<HtmlSide
					text={modifiedText}
					title={t("viewer.html.modifiedPreview", { path: resource.path })}
					viewport={viewport}
				/>
			),
		caption:
			modifiedText === null
				? t("viewer.side.newCaption", { detail: noDocument })
				: t("viewer.html.newDocument"),
		intrinsicSize: null,
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<HtmlPreviewNotice viewport={viewport} onViewport={selectViewport} />
			<div className="min-h-0 flex-1">
				<VisualDiff
					prefix="html"
					noun="document"
					selectionKey="document"
					commentLabel={t("viewer.region.commentOnDocument")}
					original={originalSide}
					modified={modifiedSide}
					contentStamp={diffContentStamp(original, modified)}
					initialMode="2-up"
					modes={["2-up"]}
					emptyLabel={noDocument}
				/>
			</div>
		</div>
	);
}
