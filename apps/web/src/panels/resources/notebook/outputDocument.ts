import { buildHtmlPreviewDocument, HTML_PREVIEW_CSP } from "../html/htmlDocument";
import type { NotebookImageMime } from "./notebookModel";

export const NOTEBOOK_HTML_CSP = HTML_PREVIEW_CSP;
export const NOTEBOOK_IMAGE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function documentWithCsp(content: string, csp: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${content}</body></html>`;
}

export function buildNotebookHtmlDocument(html: string): string {
	return buildHtmlPreviewDocument(html);
}

export function notebookImageDataUrl(mime: NotebookImageMime, data: string): string {
	if (mime === "image/svg+xml") {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
	}
	return `data:${mime};base64,${data.replaceAll(/\s/g, "")}`;
}

export function buildNotebookSvgDocument(svg: string): string {
	const source = notebookImageDataUrl("image/svg+xml", svg);
	return documentWithCsp(`<img src="${source}" alt="">`, NOTEBOOK_IMAGE_CSP);
}
