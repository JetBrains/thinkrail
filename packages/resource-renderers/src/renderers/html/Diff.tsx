import { useMemo, useState } from "react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";
import { HtmlPreviewNotice } from "./ViewportSwitch";
import { type HtmlViewport, htmlViewport } from "./viewport";

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
	original,
	modified,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const [viewport, setViewport] = useState<HtmlViewport>(() => htmlViewport(viewState));
	const selectViewport = (next: HtmlViewport) => {
		setViewport(next);
		onViewState?.({ viewport: next });
	};
	const originalText = textOf(original);
	const modifiedText = textOf(modified);
	const originalSide: VisualDiffSide = {
		present: originalText !== null,
		content:
			originalText === null ? null : (
				<HtmlSide
					text={originalText}
					title={`Original preview of ${resource.path}`}
					viewport={viewport}
				/>
			),
		caption: originalText === null ? "Old: No document" : "Old document",
		intrinsicSize: null,
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedText !== null,
		content:
			modifiedText === null ? null : (
				<HtmlSide
					text={modifiedText}
					title={`Modified preview of ${resource.path}`}
					viewport={viewport}
				/>
			),
		caption: modifiedText === null ? "New: No document" : "New document",
		intrinsicSize: null,
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<HtmlPreviewNotice viewport={viewport} onViewport={selectViewport} />
			<div className="min-h-0 flex-1">
				<VisualDiff
					prefix="html"
					noun="document"
					regionLabel="document"
					original={originalSide}
					modified={modifiedSide}
					contentStamp={diffContentStamp(original, modified)}
					initialMode="2-up"
					modes={["2-up"]}
					emptyLabel="No document"
				/>
			</div>
		</div>
	);
}
