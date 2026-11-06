import { useT } from "@thinkrail/locales/react";
import { useEffect, useState } from "react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { HtmlSourceFrame } from "./HtmlSourceFrame";
import { useHtmlViewport } from "./useHtmlViewport";
import { useScriptedHtml } from "./useScriptedHtml";
import { HtmlPreviewNotice } from "./ViewportSwitch";

function textOf(content: ResourceContent): string | null {
	return content.kind === "text" ? content.text : null;
}

interface SideHeights {
	original: number | null;
	modified: number | null;
}

export default function HtmlDiff({
	resource,
	originalResource = resource,
	original,
	modified,
	viewState,
	onViewState,
	onNaturalHeight,
}: ResourceDiffProps) {
	const t = useT();
	const noDocument = t("viewer.html.noDocument");
	const originalScripted = useScriptedHtml(originalResource);
	const modifiedScripted = useScriptedHtml(resource);
	const originalText = textOf(original);
	const modifiedText = textOf(modified);
	const fit =
		onNaturalHeight !== undefined &&
		(originalText === null || originalScripted) &&
		(modifiedText === null || modifiedScripted) &&
		(originalText !== null || modifiedText !== null);
	const [viewport, selectViewport] = useHtmlViewport(
		viewState,
		onViewState,
		fit ? "responsive" : "desktop",
	);
	const [heights, setHeights] = useState<SideHeights>({ original: null, modified: null });
	const measured =
		(originalText === null || heights.original !== null) &&
		(modifiedText === null || heights.modified !== null);
	const contentHeight = measured ? Math.max(heights.original ?? 0, heights.modified ?? 0) : null;
	useEffect(() => {
		if (fit && measured) onNaturalHeight?.();
	}, [fit, measured, onNaturalHeight]);
	const fitSide = (side: keyof SideHeights) =>
		fit
			? {
					contentHeight,
					onContentHeight: (height: number) =>
						setHeights((previous) =>
							previous[side] === height ? previous : { ...previous, [side]: height },
						),
				}
			: {};
	const originalSide: VisualDiffSide = {
		present: originalText !== null,
		content:
			originalText === null ? null : (
				<HtmlSourceFrame
					scripted={originalScripted}
					source={originalText}
					title={t("viewer.html.originalPreview", { path: originalResource.path })}
					viewport={viewport}
					{...fitSide("original")}
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
				<HtmlSourceFrame
					scripted={modifiedScripted}
					source={modifiedText}
					title={t("viewer.html.modifiedPreview", { path: resource.path })}
					viewport={viewport}
					{...fitSide("modified")}
				/>
			),
		caption:
			modifiedText === null
				? t("viewer.side.newCaption", { detail: noDocument })
				: t("viewer.html.newDocument"),
		intrinsicSize: null,
	};
	return (
		<div
			data-testid="html-diff-view"
			data-fit={fit}
			className={fit ? "flex flex-col" : "flex h-full min-h-0 flex-col"}
		>
			<HtmlPreviewNotice
				scripted={originalScripted || modifiedScripted}
				viewport={viewport}
				onViewport={selectViewport}
			/>
			<div className={fit ? "flex-none" : "min-h-0 flex-1"}>
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
					fitContent={fit}
				/>
			</div>
		</div>
	);
}
