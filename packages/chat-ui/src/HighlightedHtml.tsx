import { useLayoutEffect, useRef } from "react";
import { applyHighlightHtml, type HighlightDom } from "./highlightHtml";

export function HighlightedHtml({ html, className }: { html: string; className: string }) {
	const host = useRef<HTMLDivElement>(null);
	const dom = useRef<HighlightDom>({ stable: null });

	useLayoutEffect(() => {
		if (host.current) applyHighlightHtml(host.current, dom.current, html);
	}, [html]);

	return <div ref={host} className={className} />;
}
