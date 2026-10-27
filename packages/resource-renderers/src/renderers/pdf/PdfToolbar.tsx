import {
	RiArrowRightSLine as Next,
	RiArrowLeftSLine as Previous,
	RiZoomInLine as ZoomIn,
	RiZoomOutLine as ZoomOut,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export function PdfToolbar({
	page,
	pageCount,
	zoom,
	onPage,
	onZoom,
}: {
	page: number;
	pageCount: number;
	zoom: number;
	onPage: (page: number) => void;
	onZoom: (zoom: number) => void;
}) {
	const t = useT();
	return (
		<div className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8">
			<IconButton
				icon={Previous}
				label={t("viewer.pdf.previousPage")}
				disabled={page <= 1}
				onClick={() => onPage(page - 1)}
			/>
			<span className="min-w-64 text-center tr-text-metadata text-text-muted">
				{page} / {pageCount}
			</span>
			<IconButton
				icon={Next}
				label={t("viewer.pdf.nextPage")}
				disabled={page >= pageCount}
				onClick={() => onPage(page + 1)}
			/>
			<IconButton
				icon={ZoomOut}
				label={t("viewer.pdf.zoomOut")}
				onClick={() => onZoom(zoom / 1.2)}
			/>
			<span className="min-w-40 text-center tr-text-metadata text-text-muted">
				{Math.round(zoom * 100)}%
			</span>
			<IconButton icon={ZoomIn} label={t("viewer.pdf.zoomIn")} onClick={() => onZoom(zoom * 1.2)} />
		</div>
	);
}
