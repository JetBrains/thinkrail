import type { ReviewAnchor } from "@thinkrail/contracts";
import type { AnchorDraft, ReviewThread, SurfaceReview } from "@/resources";
import { clampRegion, type Region, regionOfAnchor } from "../regionReview";

export const MIN_PDF_ZOOM = 0.5;
export const MAX_PDF_ZOOM = 3;

export function clampPdfZoom(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, value));
}

export function pdfViewState(state: unknown): { page: number; zoom: number } {
	if (typeof state !== "object" || state === null) return { page: 1, zoom: 1 };
	const pageValue = Reflect.get(state, "page");
	const zoomValue = Reflect.get(state, "zoom");
	return {
		page:
			typeof pageValue === "number" && Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1,
		zoom: clampPdfZoom(typeof zoomValue === "number" ? zoomValue : 1),
	};
}

export function pdfRegionDraft(region: Region, page: number): AnchorDraft {
	const normalized = clampRegion(region);
	return {
		selectors: [{ ...normalized, page }],
		label: `p${page} region`,
	};
}

export function pdfRegionOfAnchor(anchor: ReviewAnchor, page: number): Region | null {
	const region = regionOfAnchor(anchor);
	return region?.page === page ? region : null;
}

export function pdfPageOfAnchor(anchor: ReviewAnchor): number | null {
	const region = regionOfAnchor(anchor);
	return region?.page ?? null;
}

export function pdfReviewForPage(
	review: SurfaceReview | undefined,
	page: number,
): SurfaceReview | undefined {
	if (!review) return undefined;
	return {
		...review,
		threads: review.threads.filter((thread) => pdfRegionOfAnchor(thread.anchor, page)),
		focus: review.focus && pdfPageOfAnchor(review.focus.anchor) === page ? review.focus : null,
	};
}

export function pdfCurrentPage(visiblePages: ReadonlySet<number>, fallback: number): number {
	let current: number | null = null;
	for (const page of visiblePages) if (current === null || page < current) current = page;
	return current ?? fallback;
}

export function updatePdfPageSet(
	current: ReadonlySet<number>,
	page: number,
	present: boolean,
): ReadonlySet<number> {
	const next = new Set(current);
	if (present) next.add(page);
	else next.delete(page);
	if (next.size === current.size && [...next].every((entry) => current.has(entry))) return current;
	return next;
}

export function placedPdfThreadIds(
	threads: readonly ReviewThread[],
	pageCount: number,
): ReadonlySet<string> {
	return new Set(
		threads.flatMap((thread) => {
			const page = pdfPageOfAnchor(thread.anchor);
			return page !== null && page <= pageCount ? [thread.id] : [];
		}),
	);
}

export type PdfPageResolution =
	| { state: "none" }
	| { state: "unknown"; page: number }
	| { state: "unplaceable"; page: number }
	| { state: "placeable"; page: number };

export function resolvePdfPage(
	requestedPage: number | null,
	pageCount: number | null,
): PdfPageResolution {
	if (requestedPage === null) return { state: "none" };
	if (pageCount === null) return { state: "unknown", page: requestedPage };
	if (requestedPage > pageCount) return { state: "unplaceable", page: requestedPage };
	return { state: "placeable", page: requestedPage };
}

export function pdfFocusPending(
	resolution: PdfPageResolution,
	residentPages: ReadonlySet<number>,
): boolean {
	return (
		resolution.state === "unknown" ||
		(resolution.state === "placeable" && !residentPages.has(resolution.page))
	);
}

export const PDF_RENDER_WINDOW_RADIUS = 2;

export function pdfRenderWindow(
	visiblePages: ReadonlySet<number>,
	pageCount: number,
	forcedPage: number | null = null,
): ReadonlySet<number> {
	const forced =
		forcedPage !== null && forcedPage >= 1 && forcedPage <= pageCount ? forcedPage : null;
	const centers = forced === null ? visiblePages : new Set([forced]);
	const window = new Set<number>();
	for (const center of centers) {
		if (!Number.isInteger(center) || center < 1 || center > pageCount) continue;
		const start = Math.max(1, center - PDF_RENDER_WINDOW_RADIUS);
		const end = Math.min(pageCount, center + PDF_RENDER_WINDOW_RADIUS);
		for (let page = start; page <= end; page += 1) window.add(page);
	}
	return window;
}

export interface PdfPageReleasePlan {
	retained: ReadonlySet<number>;
	released: ReadonlySet<number>;
}

export function pdfPageReleasePlan(
	residentPages: ReadonlySet<number>,
	renderWindow: ReadonlySet<number>,
): PdfPageReleasePlan {
	const released = new Set([...residentPages].filter((page) => !renderWindow.has(page)));
	if (released.size === 0) return { retained: residentPages, released };
	return {
		retained: new Set([...residentPages].filter((page) => renderWindow.has(page))),
		released,
	};
}

export function pdfPageContentStamp(documentIdentity: string, page: number): string {
	return JSON.stringify([documentIdentity, page]);
}

export function pdfSourceUrl(url: string, hash: string): string {
	const path = url.split(/[?#]/, 1)[0] ?? "";
	if (!/(?:^|\/)files(?:\/|$)/.test(path)) return url;
	const fragmentIndex = url.indexOf("#");
	const fragment = fragmentIndex >= 0 ? url.slice(fragmentIndex) : "";
	const base = fragmentIndex >= 0 ? url.slice(0, fragmentIndex) : url;
	return `${base}${base.includes("?") ? "&" : "?"}h=${encodeURIComponent(hash)}${fragment}`;
}
