import { type Translator, useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { SvgFrame } from "./SvgFrame";
import {
	buildSvgDocument,
	type SvgThemeTokens,
	svgByteLength,
	svgDiffViewState,
	svgIntrinsicSize,
} from "./svgDocument";
import { useSvgTheme } from "./useSvgTheme";

function textOf(content: ResourceContent): string | null {
	return content.kind === "text" ? content.text : null;
}

function SvgContent({
	text,
	tokens,
	path,
}: {
	text: string;
	tokens: SvgThemeTokens;
	path: string;
}) {
	const t = useT();
	const document = useMemo(() => buildSvgDocument(text, tokens), [text, tokens]);
	return <SvgFrame title={t("viewer.svg.diffTitle", { path })} document={document} />;
}

function caption(t: Translator, side: "old" | "new", text: string | null): string {
	const key = side === "old" ? "viewer.side.oldCaption" : "viewer.side.newCaption";
	if (text === null) return t(key, { detail: t("viewer.image.noImage") });
	const size = svgIntrinsicSize(text);
	const dimensions = size ? `${size.width} × ${size.height}` : t("viewer.svg.flexibleSize");
	return t(key, { detail: `${dimensions} · ${svgByteLength(text)} B` });
}

export default function SvgDiff({
	resource,
	originalResource = resource,
	original,
	modified,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const t = useT();
	const tokens = useSvgTheme(true);
	const originalText = textOf(original);
	const modifiedText = textOf(modified);
	if (!tokens) return null;
	const originalSize = originalText === null ? null : svgIntrinsicSize(originalText);
	const modifiedSize = modifiedText === null ? null : svgIntrinsicSize(modifiedText);
	const originalSide: VisualDiffSide = {
		present: originalText !== null,
		content:
			originalText === null ? null : (
				<SvgContent text={originalText} tokens={tokens} path={originalResource.path} />
			),
		caption: caption(t, "old", originalText),
		intrinsicSize: originalSize,
		review: review?.base,
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedText !== null,
		content:
			modifiedText === null ? null : (
				<SvgContent text={modifiedText} tokens={tokens} path={resource.path} />
			),
		caption: caption(t, "new", modifiedText),
		intrinsicSize: modifiedSize,
		review: review?.worktree,
	};
	return (
		<VisualDiff
			prefix="svg"
			noun="vector"
			selectionKey="image region"
			commentLabel={t("viewer.region.commentOnImageRegion")}
			original={originalSide}
			modified={modifiedSide}
			contentStamp={diffContentStamp(original, modified)}
			onPlacedThreadIds={onPlacedThreadIds}
			initialMode={svgDiffViewState(viewState)}
			onViewState={onViewState}
		/>
	);
}
