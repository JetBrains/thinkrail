import { useMemo } from "react";
import type { ResourceContent, ResourceDiffProps } from "@/resources";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { SvgFrame } from "./SvgFrame";
import {
	buildSvgDocument,
	type SvgThemeTokens,
	svgByteLength,
	svgDiffViewState,
	svgFileDraft,
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
	const document = useMemo(() => buildSvgDocument(text, tokens), [text, tokens]);
	return <SvgFrame title={`Vector diff of ${path}`} document={document} />;
}

function caption(label: string, text: string | null): string {
	if (text === null) return `${label}: No image`;
	const size = svgIntrinsicSize(text);
	return `${label}: ${size ? `${size.width} × ${size.height}` : "Flexible size"} · ${svgByteLength(text)} B`;
}

export default function SvgDiff({
	resource,
	original,
	modified,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
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
				<SvgContent text={originalText} tokens={tokens} path={resource.path} />
			),
		caption: caption("Old", originalText),
		intrinsicSize: originalSize,
		review: review?.base,
		draftForRegion: originalText === null ? undefined : svgFileDraft,
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedText !== null,
		content:
			modifiedText === null ? null : (
				<SvgContent text={modifiedText} tokens={tokens} path={resource.path} />
			),
		caption: caption("New", modifiedText),
		intrinsicSize: modifiedSize,
		review: review?.worktree,
		draftForRegion: modifiedText === null ? undefined : svgFileDraft,
	};
	return (
		<VisualDiff
			prefix="svg"
			noun="vector"
			regionLabel="file"
			original={originalSide}
			modified={modifiedSide}
			contentStamp={diffContentStamp(original, modified)}
			onPlacedThreadIds={onPlacedThreadIds}
			initialMode={svgDiffViewState(viewState)}
			onViewState={onViewState}
		/>
	);
}
