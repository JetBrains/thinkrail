import { useT } from "@thinkrail/locales/react";
import { useMemo, useState } from "react";
import { useResourceEnvironment } from "../../host";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import { diffContentStamp } from "../reviewComposerState";
import { sideCaption, VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument, buildInteractiveHtmlDocument } from "./htmlDocument";
import { createScrollLink, type ScrollLink } from "./scrollLink";
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
	scrollLink,
	interactive,
}: {
	text: string;
	title: string;
	viewport: HtmlViewport;
	scrollLink: ScrollLink;
	interactive: boolean;
}) {
	const built = useMemo(
		() =>
			interactive
				? buildInteractiveHtmlDocument(text)
				: { document: buildHtmlPreviewDocument(text), token: undefined },
		[text, interactive],
	);
	const compact = useResourceEnvironment().compact ?? false;
	return (
		<HtmlFrame
			title={title}
			document={built.document}
			viewport={viewport}
			scrollLink={scrollLink}
			compact={compact}
			interactiveToken={built.token}
		/>
	);
}

export function HtmlComparison({
	resource,
	originalResource = resource,
	original,
	modified,
	viewState,
	onViewState,
	sideLabels,
	interactive,
}: ResourceDiffProps & { interactive: (path: string) => boolean }) {
	const t = useT();
	const noDocument = t("viewer.html.noDocument");
	const [viewport, selectViewport] = useHtmlViewport(viewState, onViewState);
	const [scrollLink] = useState(createScrollLink);
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
					scrollLink={scrollLink}
					interactive={interactive(originalResource.path)}
				/>
			),
		caption:
			originalText === null
				? sideCaption(t, "old", noDocument, sideLabels)
				: (sideLabels?.original ?? t("viewer.html.oldDocument")),
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
					scrollLink={scrollLink}
					interactive={interactive(resource.path)}
				/>
			),
		caption:
			modifiedText === null
				? sideCaption(t, "new", noDocument, sideLabels)
				: (sideLabels?.modified ?? t("viewer.html.newDocument")),
		intrinsicSize: null,
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<HtmlPreviewNotice
				viewport={viewport}
				onViewport={selectViewport}
				interactive={interactive(resource.path) || interactive(originalResource.path)}
			/>
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
					emptyLabel={noDocument}
					labels={sideLabels}
				/>
			</div>
		</div>
	);
}

const STATIC = () => false;

export default function HtmlDiff(props: ResourceDiffProps) {
	return <HtmlComparison {...props} interactive={STATIC} />;
}
