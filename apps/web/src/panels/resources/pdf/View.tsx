import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResourceViewProps } from "@/resources";
import type { Size } from "../regionReview";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { PdfToolbar } from "./PdfToolbar";
import { PdfRenderQueue } from "./pdfLoader";
import {
	clampPdfZoom,
	pdfFocusPending,
	pdfPageOfAnchor,
	pdfPageReleasePlan,
	pdfRenderWindow,
	pdfViewState,
	placedPdfThreadIds,
	resolvePdfPage,
	updatePdfPageSet,
} from "./pdfModel";
import { usePdfDocument } from "./usePdfDocument";

const NO_THREADS: ReadonlySet<string> = new Set();
const NO_PAGES: ReadonlySet<number> = new Set();

export default function PdfView({
	content,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceViewProps) {
	const initial = pdfViewState(viewState);
	const [page, setPage] = useState(initial.page);
	const [zoom, setZoom] = useState(initial.zoom);
	const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(NO_PAGES);
	const [residentPages, setResidentPages] = useState<ReadonlySet<number>>(NO_PAGES);
	const loaded = usePdfDocument(content);
	const queue = useMemo(() => new PdfRenderQueue(2), [loaded.identity]);
	const pageRefs = useRef(new Map<number, HTMLElement>());
	const placementReportedRef = useRef(false);
	const pageCount = loaded.document?.numPages ?? null;
	const requestedFocusPage = review?.focus ? pdfPageOfAnchor(review.focus.anchor) : null;
	const focusResolution = resolvePdfPage(requestedFocusPage, pageCount);
	const focusPage = focusResolution.state === "placeable" ? focusResolution.page : null;
	const focusPending = pdfFocusPending(focusResolution, residentPages);
	const renderWindow = useMemo(
		() => pdfRenderWindow(visiblePages, pageCount ?? 0, focusPage),
		[focusPage, pageCount, visiblePages],
	);
	const placed = useMemo(
		() => (pageCount === null ? null : placedPdfThreadIds(review?.threads ?? [], pageCount)),
		[pageCount, review?.threads],
	);
	const registerElement = useCallback((pageNumber: number, element: HTMLElement | null) => {
		if (element) pageRefs.current.set(pageNumber, element);
		else pageRefs.current.delete(pageNumber);
	}, []);
	const markVisible = useCallback((pageNumber: number, visible: boolean) => {
		setVisiblePages((current) => updatePdfPageSet(current, pageNumber, visible));
	}, []);
	const markRendered = useCallback((pageNumber: number, size: Size | null) => {
		setResidentPages((current) => updatePdfPageSet(current, pageNumber, size !== null));
	}, []);

	useEffect(() => {
		setResidentPages(NO_PAGES);
	}, [loaded.identity, zoom]);

	useEffect(() => {
		setResidentPages((current) => pdfPageReleasePlan(current, renderWindow).retained);
	}, [renderWindow]);

	useEffect(() => {
		if (!placed) return;
		placementReportedRef.current = true;
		onPlacedThreadIds?.(placed);
	}, [onPlacedThreadIds, placed]);

	useEffect(
		() => () => {
			if (placementReportedRef.current) onPlacedThreadIds?.(NO_THREADS);
		},
		[onPlacedThreadIds],
	);

	useEffect(() => {
		if (focusPage === null) return;
		setPage(focusPage);
		setVisiblePages(new Set([focusPage]));
		pageRefs.current.get(focusPage)?.scrollIntoView({ block: "center" });
	}, [focusPage, focusPending, pageCount]);

	useEffect(() => {
		if (!loaded.document || requestedFocusPage !== null) return;
		const restoredPage = Math.min(loaded.document.numPages, Math.max(1, page));
		if (restoredPage !== page) setPage(restoredPage);
		setVisiblePages(new Set([restoredPage]));
		pageRefs.current.get(restoredPage)?.scrollIntoView({ block: "start" });
	}, [loaded.document, page, requestedFocusPage, zoom]);

	if (loaded.error) {
		return (
			<div className="flex h-full items-center justify-center bg-container-workspace-bg tr-text-ui text-feedback-error">
				PDF preview failed.
			</div>
		);
	}
	if (!loaded.document) {
		return (
			<div className="flex h-full items-center justify-center bg-container-workspace-bg tr-text-ui text-text-muted">
				Loading PDF…
			</div>
		);
	}
	const document = loaded.document;
	const goToPage = (nextPage: number) => {
		const bounded = Math.min(document.numPages, Math.max(1, nextPage));
		setPage(bounded);
		setVisiblePages(new Set([bounded]));
		pageRefs.current.get(bounded)?.scrollIntoView({ block: "start" });
		onViewState?.({ page: bounded, zoom });
	};
	const changeZoom = (nextZoom: number) => {
		const bounded = clampPdfZoom(nextZoom);
		setZoom(bounded);
		onViewState?.({ page, zoom: bounded });
	};

	return (
		<div data-testid="pdf-view" className="flex h-full min-h-0 flex-col bg-container-content-bg">
			<PdfToolbar
				page={page}
				pageCount={document.numPages}
				zoom={zoom}
				onPage={goToPage}
				onZoom={changeZoom}
			/>
			<div data-pdf-scroll className="min-h-0 flex-1 overflow-auto p-12">
				<div className="mx-auto flex max-w-[1200px] flex-col gap-16">
					{Array.from({ length: document.numPages }, (_value, index) => {
						const pageNumber = index + 1;
						return (
							<PdfPageCanvas
								key={pageNumber}
								document={document}
								page={pageNumber}
								zoom={zoom}
								queue={queue}
								review={review}
								stamp={loaded.identity}
								active={renderWindow.has(pageNumber)}
								onVisibility={markVisible}
								onRendered={markRendered}
								registerElement={registerElement}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
