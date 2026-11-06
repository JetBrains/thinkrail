import { useMemo } from "react";
import { HtmlFrame } from "./HtmlFrame";
import { buildHtmlPreviewDocument } from "./htmlDocument";
import { ScriptedHtmlFrame } from "./ScriptedHtmlFrame";
import type { HtmlViewport } from "./viewport";

interface SourceFrameProps {
	title: string;
	source: string;
	viewport: HtmlViewport;
}

function StaticHtmlFrame({ title, source, viewport }: SourceFrameProps) {
	const document = useMemo(() => buildHtmlPreviewDocument(source), [source]);
	return <HtmlFrame title={title} document={document} viewport={viewport} />;
}

export function HtmlSourceFrame({
	scripted,
	...props
}: SourceFrameProps & {
	scripted: boolean;
	contentHeight?: number | null;
	onContentHeight?: (height: number) => void;
}) {
	if (scripted) return <ScriptedHtmlFrame {...props} />;
	return <StaticHtmlFrame title={props.title} source={props.source} viewport={props.viewport} />;
}
