import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import type { ResourceViewProps } from "../../registry";
import { HtmlSourceFrame } from "./HtmlSourceFrame";
import { useHtmlViewport } from "./useHtmlViewport";
import { useScriptedHtml } from "./useScriptedHtml";
import { HtmlPreviewNotice } from "./ViewportSwitch";

export default function HtmlView({
	resource,
	content,
	viewState,
	onViewState,
	onNaturalHeight,
}: ResourceViewProps) {
	const t = useT();
	const text = content.kind === "text" ? content.text : "";
	const scripted = useScriptedHtml(resource);
	const fit = scripted && onNaturalHeight !== undefined;
	const [viewport, selectViewport] = useHtmlViewport(
		viewState,
		onViewState,
		fit ? "responsive" : "desktop",
	);
	const [contentHeight, setContentHeight] = useState<number | null>(null);
	const measured = contentHeight !== null;
	useEffect(() => {
		if (fit && measured) onNaturalHeight?.();
	}, [fit, measured, onNaturalHeight]);
	const title = t("viewer.html.preview", { path: resource.path });
	return (
		<div
			data-testid="html-view"
			data-scripted={scripted}
			className={cn("flex min-h-0 flex-col bg-container-workspace-bg", fit ? null : "h-full")}
		>
			<HtmlPreviewNotice scripted={scripted} viewport={viewport} onViewport={selectViewport} />
			<div className={fit ? "flex-none" : "min-h-0 flex-1 p-12"}>
				<HtmlSourceFrame
					scripted={scripted}
					title={title}
					source={text}
					viewport={viewport}
					{...(fit ? { contentHeight, onContentHeight: setContentHeight } : {})}
				/>
			</div>
		</div>
	);
}
