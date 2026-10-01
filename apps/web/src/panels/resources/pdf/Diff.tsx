import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResourceDiffProps } from "@/resources";
import { PdfDiffPage } from "./PdfDiffPage";
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
type Side = "base" | "worktree";

export default function PdfDiff({
	original,
	modified,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const initial = pdfViewState(viewState);
	const [page, setPage] = useState(initial.page);
	const [zoom, setZoom] = useState(initial.zoom);
	const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(NO_PAGES);
	const [basePages, setBasePages] = useState<ReadonlySet<number>>(NO_PAGES);
	const [worktreePages, setWorktreePages] = useState<ReadonlySet<number>>(NO_PAGES);
	const originalLoaded = usePdfDocument(original);
	const modifiedLoaded = usePdfDocument(modified);
	const queue = useMemo(
		() => new PdfRenderQueue(2),
		[modifiedLoaded.identity, originalLoaded.identity],
	);
	const pageRefs = useRef(new Map<number, HTMLElement>());
	const placementReportedRef = useRef(false);
	const basePageCount = originalLoaded.settled ? (originalLoaded.document?.numPages ?? 0) : null;
	const worktreePageCount = modifiedLoaded.settled
		? (modifiedLoaded.document?.numPages ?? 0)
		: null;
	const pageCount =
		basePageCount === null || worktreePageCount === null
			? null
			: Math.max(basePageCount, worktreePageCount);
	const focusSide = review?.worktree.focus ? "worktree" : review?.base.focus ? "base" : null;
	const focusAnchor =
		focusSide === "worktree" ? review?.worktree.focus?.anchor : review?.base.focus?.anchor;
	const requestedFocusPage = focusAnchor ? pdfPageOfAnchor(focusAnchor) : null;
	const focusPageCount =
		focusSide === "worktree" ? worktreePageCount : focusSide === "base" ? basePageCount : pageCount;
	const focusResidentPages = focusSide === "base" ? basePages : worktreePages;
	const focusResolution = resolvePdfPage(requestedFocusPage, focusPageCount);
	const focusPage = focusResolution.state === "placeable" ? focusResolution.page : null;
	const focusPending = pdfFocusPending(focusResolution, focusResidentPages);
	const renderWindow = useMemo(
		() => pdfRenderWindow(visiblePages, pageCount ?? 0, focusPage),
		[focusPage, pageCount, visiblePages],
	);
	const placed = useMemo(() => {
		if (basePageCount === null || worktreePageCount === null) return null;
		const ids = new Set<string>();
		for (const id of placedPdfThreadIds(review?.base.threads ?? [], basePageCount)) ids.add(id);
		for (const id of placedPdfThreadIds(review?.worktree.threads ?? [], worktreePageCount)) {
			ids.add(id);
		}
		return ids;
	}, [basePageCount, review?.base.threads, review?.worktree.threads, worktreePageCount]);
	const registerElement = useCallback((pageNumber: number, element: HTMLElement | null) => {
		if (element) pageRefs.current.set(pageNumber, element);
		else pageRefs.current.delete(pageNumber);
	}, []);
	const markVisible = useCallback((pageNumber: number, visible: boolean) => {
		setVisiblePages((current) => updatePdfPageSet(current, pageNumber, visible));
	}, []);
	const markRendered = useCallback((side: Side, pageNumber: number, rendered: boolean) => {
		const update = (current: ReadonlySet<number>) =>
			updatePdfPageSet(current, pageNumber, rendered);
		if (side === "base") setBasePages(update);
		else setWorktreePages(update);
	}, []);

	useEffect(() => {
		setBasePages(NO_PAGES);
		setWorktreePages(NO_PAGES);
	}, [modifiedLoaded.identity, originalLoaded.identity, zoom]);

	useEffect(() => {
		setBasePages((current) => pdfPageReleasePlan(current, renderWindow).retained);
		setWorktreePages((current) => pdfPageReleasePlan(current, renderWindow).retained);
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
		if (requestedFocusPage !== null || pageCount === null || pageCount === 0) return;
		const restoredPage = Math.min(pageCount, Math.max(1, page));
		if (restoredPage !== page) setPage(restoredPage);
		setVisiblePages(new Set([restoredPage]));
		pageRefs.current.get(restoredPage)?.scrollIntoView({ block: "start" });
	}, [page, pageCount, requestedFocusPage, zoom]);

	if (originalLoaded.error || modifiedLoaded.error) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-feedback-error">
				PDF diff failed.
			</div>
		);
	}
	if (!originalLoaded.settled || !modifiedLoaded.settled) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				Loading PDF diff…
			</div>
		);
	}
	const availablePageCount = pageCount ?? 0;
	const goToPage = (nextPage: number) => {
		const bounded = Math.min(Math.max(1, availablePageCount), Math.max(1, nextPage));
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
	const stamp = JSON.stringify([originalLoaded.identity, modifiedLoaded.identity]);

	return (
		<div data-testid="pdf-diff" className="flex h-full min-h-0 flex-col bg-container-content-bg">
			<PdfToolbar
				page={page}
				pageCount={availablePageCount}
				zoom={zoom}
				onPage={goToPage}
				onZoom={changeZoom}
			/>
			<div data-pdf-scroll className="min-h-0 flex-1 overflow-auto p-12">
				<div className="flex flex-col gap-16">
					{Array.from({ length: availablePageCount }, (_value, index) => {
						const pageNumber = index + 1;
						return (
							<PdfDiffPage
								key={pageNumber}
								original={originalLoaded.document}
								modified={modifiedLoaded.document}
								page={pageNumber}
								zoom={zoom}
								queue={queue}
								baseReview={review?.base}
								worktreeReview={review?.worktree}
								stamp={stamp}
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
