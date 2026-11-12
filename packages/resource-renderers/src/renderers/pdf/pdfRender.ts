import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Size } from "../regionReview";

const PDF_CSS_SCALE = 4 / 3;

export interface PdfCanvasRender {
	size: Size;
	task: RenderTask;
}

export function releasePdfCanvas(canvas: Pick<HTMLCanvasElement, "width" | "height">): void {
	canvas.width = 0;
	canvas.height = 0;
}

export async function renderPdfPageToCanvas(
	document: PDFDocumentProxy,
	pageNumber: number,
	zoom: number,
	canvas: HTMLCanvasElement,
): Promise<PdfCanvasRender> {
	const page = await document.getPage(pageNumber);
	const viewport = page.getViewport({ scale: PDF_CSS_SCALE * zoom });
	const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
	canvas.width = Math.ceil(viewport.width * pixelRatio);
	canvas.height = Math.ceil(viewport.height * pixelRatio);
	const task = page.render({
		canvas,
		viewport,
		transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
	});
	return {
		size: { width: viewport.width, height: viewport.height },
		task,
	};
}

export async function canvasBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => {
			if (value) resolve(value);
			else reject(new Error("PDF page bitmap creation failed"));
		}, "image/png");
	});
	return URL.createObjectURL(blob);
}
