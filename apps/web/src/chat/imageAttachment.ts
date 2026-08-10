// Attach-time image downscale (TASK-image-attachment-downscale). Pasted/dropped images are decoded and
// resized in the browser BEFORE they become ImageContent: pi's own resizer is deliberately disabled
// server-side (`images.autoResize:false` — its photon/WASM codec can't ship in the single-file binary),
// so anything the composer lets through goes to the provider verbatim. Anthropic rejects a side over
// 8000px — and over 2000px once a request carries more than 20 images — and because history is re-sent
// every turn, ONE oversized attachment bricks the whole chat. Capping at 1568px (Claude's standard-tier
// long edge, beyond which it downsamples anyway) stays under every limit while losing nothing the model
// would actually see. The server-side `imageGuard` extension is the second line of defense for images
// that predate this or arrive by other routes.

import type { ImageContent } from "@thinkrail/contracts";

/** Claude's standard-tier long-edge; larger images are downsampled provider-side anyway. */
export const MAX_ATTACHMENT_EDGE = 1568;

/** A composer attachment: the wire content plus the pixel size of what will actually be sent.
 * `width`/`height` are undefined only when the browser couldn't decode the file (sent raw as-is). */
export interface AttachedImage {
	content: ImageContent;
	width?: number;
	height?: number;
}

/** Aspect-preserving fit of `width`×`height` into a `maxEdge` square: unchanged when already within,
 * else scaled so the long edge equals `maxEdge` (rounded, floored at 1px). */
export function fitWithin(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	const longEdge = Math.max(width, height);
	if (longEdge <= maxEdge) return { width, height };
	const scale = maxEdge / longEdge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** Mime types canvas.toDataURL can (re-)encode; anything else re-encodes as PNG when resized. */
const CANVAS_ENCODABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

function fileToRawContent(file: File): Promise<ImageContent> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
		reader.onload = () => {
			const result = String(reader.result);
			const comma = result.indexOf(",");
			resolve({
				type: "image",
				data: comma >= 0 ? result.slice(comma + 1) : result,
				mimeType: file.type || "image/png",
			});
		};
		reader.readAsDataURL(file);
	});
}

function dataUrlToContent(dataUrl: string): ImageContent {
	const comma = dataUrl.indexOf(",");
	const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
	return { type: "image", data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mimeType };
}

/**
 * Turn a picked/pasted/dropped file into a composer attachment, downscaled to MAX_ATTACHMENT_EDGE when
 * its long edge exceeds it. Within-bounds images pass through byte-identical (no re-encode, no quality
 * loss); a resized one re-encodes in its own format when canvas supports it, else PNG. A file the
 * browser can't decode falls back to the raw bytes — attaching must never fail here; the server-side
 * guard still protects the session.
 */
export async function fileToAttachedImage(file: File): Promise<AttachedImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return { content: await fileToRawContent(file) };
	}
	try {
		const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_ATTACHMENT_EDGE);
		if (width === bitmap.width && height === bitmap.height) {
			return { content: await fileToRawContent(file), width, height };
		}
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return { content: await fileToRawContent(file) };
		ctx.drawImage(bitmap, 0, 0, width, height);
		const mimeType = CANVAS_ENCODABLE.has(file.type) ? file.type : "image/png";
		return { content: dataUrlToContent(canvas.toDataURL(mimeType)), width, height };
	} finally {
		bitmap.close();
	}
}
