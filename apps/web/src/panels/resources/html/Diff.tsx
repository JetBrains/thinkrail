import { useMemo } from "react";
import type { ResourceContent, ResourceDiffProps } from "@/resources";
import { diffContentStamp } from "../reviewComposerState";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";

function textOf(content: ResourceContent): string | null {
	return content.kind === "text" ? content.text : null;
}

function HtmlSide({ text, title }: { text: string; title: string }) {
	const document = useMemo(() => buildHtmlPreviewDocument(text), [text]);
	return <HtmlFrame title={title} document={document} />;
}

export default function HtmlDiff({ resource, original, modified }: ResourceDiffProps) {
	const originalText = textOf(original);
	const modifiedText = textOf(modified);
	const originalSide: VisualDiffSide = {
		present: originalText !== null,
		content:
			originalText === null ? null : (
				<HtmlSide text={originalText} title={`Original preview of ${resource.path}`} />
			),
		caption: originalText === null ? "Old: No document" : "Old document",
		intrinsicSize: null,
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedText !== null,
		content:
			modifiedText === null ? null : (
				<HtmlSide text={modifiedText} title={`Modified preview of ${resource.path}`} />
			),
		caption: modifiedText === null ? "New: No document" : "New document",
		intrinsicSize: null,
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-border-default border-b bg-feedback-info-subtle px-12 py-8 tr-text-metadata text-feedback-info">
				Scripts and external resources are disabled.
			</div>
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
