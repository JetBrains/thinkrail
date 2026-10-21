import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { HTML_VIEWPORT_LABELS, HTML_VIEWPORTS, type HtmlViewport } from "./viewport";

export function HtmlPreviewNotice({
	viewport,
	onViewport,
}: {
	viewport: HtmlViewport;
	onViewport: (viewport: HtmlViewport) => void;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-8 border-border-default border-b bg-feedback-info-subtle px-12 py-4 tr-text-metadata text-feedback-info">
			<span data-testid="html-disabled-notice" className="mr-auto">
				Scripts and external resources are disabled.
			</span>
			<fieldset
				data-testid="html-viewport"
				aria-label="Preview width"
				className="m-0 flex gap-2 border-0 p-0"
			>
				{HTML_VIEWPORTS.map((candidate) => (
					<ToggleSegment
						key={candidate}
						testid={`html-viewport-${candidate}`}
						label={HTML_VIEWPORT_LABELS[candidate]}
						active={candidate === viewport}
						onClick={() => onViewport(candidate)}
					/>
				))}
			</fieldset>
		</div>
	);
}
