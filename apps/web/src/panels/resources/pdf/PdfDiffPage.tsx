import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceReview } from "@/resources";
import type { Size } from "../regionReview";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import type { PdfRenderQueue } from "./pdfLoader";
import { pdfPageContentStamp, pdfRegionDraft, pdfReviewForPage } from "./pdfModel";
import { canvasBlobUrl, releasePdfCanvas, renderPdfPageToCanvas } from "./pdfRender";

interface Bitmap {
	url: string;
	size: Size;
}

type DiffSide = "base" | "worktree";

function BitmapImage({ bitmap, title }: { bitmap: Bitmap; title: string }) {
	return (
		<img
			src={bitmap.url}
			alt={title}
			className="block h-full w-full object-contain"
			draggable={false}
		/>
	);
}

export function PdfDiffPage({
	original,
	modified,
	page,
	zoom,
	queue,
	baseReview,
	worktreeReview,
	stamp,
	active,
	onVisibility,
	onRendered,
	registerElement,
}: {
	original: PDFDocumentProxy | null;
	modified: PDFDocumentProxy | null;
	page: number;
	zoom: number;
	queue: PdfRenderQueue;
	baseReview?: SurfaceReview | undefined;
	worktreeReview?: SurfaceReview | undefined;
	stamp: string;
	active: boolean;
	onVisibility: (page: number, visible: boolean) => void;
	onRendered: (side: DiffSide, page: number, rendered: boolean) => void;
	registerElement: (page: number, element: HTMLElement | null) => void;
}) {
	const rootRef = useRef<HTMLElement | null>(null);
	const [originalBitmap, setOriginalBitmap] = useState<Bitmap | null>(null);
	const [modifiedBitmap, setModifiedBitmap] = useState<Bitmap | null>(null);
	const pageBaseReview = useMemo(() => pdfReviewForPage(baseReview, page), [baseReview, page]);
	const pageWorktreeReview = useMemo(
		() => pdfReviewForPage(worktreeReview, page),
		[page, worktreeReview],
	);

	useEffect(() => {
		const element = rootRef.current;
		if (!element) return;
		const root = element.closest<HTMLElement>("[data-pdf-scroll]");
		const observer = new IntersectionObserver(
			(entries) =>
				onVisibility(
					page,
					entries.some((entry) => entry.isIntersecting),
				),
			{ root },
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			onVisibility(page, false);
		};
	}, [onVisibility, page]);

	useEffect(() => {
		if (!active) {
			setOriginalBitmap(null);
			setModifiedBitmap(null);
			onRendered("base", page, false);
			onRendered("worktree", page, false);
			return;
		}
		const controller = new AbortController();
		const tasks: RenderTask[] = [];
		const urls: string[] = [];
		const canvases: HTMLCanvasElement[] = [];
		const render = (
			document: PDFDocumentProxy | null,
			side: DiffSide,
			setBitmap: (bitmap: Bitmap | null) => void,
		) => {
			setBitmap(null);
			onRendered(side, page, false);
			if (!document || page > document.numPages) return;
			void queue
				.run(async () => {
					if (controller.signal.aborted) return;
					const canvas = window.document.createElement("canvas");
					canvases.push(canvas);
					const rendered = await renderPdfPageToCanvas(document, page, zoom, canvas);
					tasks.push(rendered.task);
					if (controller.signal.aborted) {
						rendered.task.cancel();
						return;
					}
					await rendered.task.promise;
					if (controller.signal.aborted) return;
					const url = await canvasBlobUrl(canvas);
					releasePdfCanvas(canvas);
					if (controller.signal.aborted) {
						URL.revokeObjectURL(url);
						return;
					}
					urls.push(url);
					setBitmap({ url, size: rendered.size });
					onRendered(side, page, true);
				}, controller.signal)
				.catch(() => {
					if (!controller.signal.aborted) onRendered(side, page, false);
				});
		};
		render(original, "base", setOriginalBitmap);
		render(modified, "worktree", setModifiedBitmap);
		return () => {
			controller.abort();
			for (const task of tasks) task.cancel();
			for (const canvas of canvases) releasePdfCanvas(canvas);
			for (const url of urls) URL.revokeObjectURL(url);
			onRendered("base", page, false);
			onRendered("worktree", page, false);
		};
	}, [active, modified, onRendered, original, page, queue, zoom]);

	const originalPresent = Boolean(original && page <= original.numPages);
	const modifiedPresent = Boolean(modified && page <= modified.numPages);
	const originalSide: VisualDiffSide = {
		present: originalPresent,
		content: originalBitmap ? (
			<BitmapImage bitmap={originalBitmap} title={`Original PDF page ${page}`} />
		) : null,
		caption: originalPresent ? `Old: page ${page}` : "Old: No page",
		intrinsicSize: originalBitmap?.size ?? null,
		review: pageBaseReview,
		draftForRegion: (region) => pdfRegionDraft(region, page),
	};
	const modifiedSide: VisualDiffSide = {
		present: modifiedPresent,
		content: modifiedBitmap ? (
			<BitmapImage bitmap={modifiedBitmap} title={`Modified PDF page ${page}`} />
		) : null,
		caption: modifiedPresent ? `New: page ${page}` : "New: No page",
		intrinsicSize: modifiedBitmap?.size ?? null,
		review: pageWorktreeReview,
		draftForRegion: (region) => pdfRegionDraft(region, page),
	};

	return (
		<section
			ref={(element) => {
				rootRef.current = element;
				registerElement(page, element);
			}}
			data-testid="pdf-diff-page"
			data-page={page}
			className="flex min-h-[680px] flex-col gap-4"
		>
			<span className="tr-text-metadata text-text-muted">Page {page}</span>
			{active ? (
				<VisualDiff
					prefix="image"
					noun="page"
					regionLabel={`page ${page} region`}
					original={originalSide}
					modified={modifiedSide}
					contentStamp={pdfPageContentStamp(stamp, page)}
					initialMode="2-up"
					emptyLabel="No page"
				/>
			) : null}
		</section>
	);
}
