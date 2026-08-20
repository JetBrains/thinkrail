// Attach-time image downscale (TASK-image-attachment-downscale). Pasted/dropped images are decoded and
// resized in the browser BEFORE they become ImageContent: pi's own resizer is deliberately disabled
// server-side (`images.autoResize:false` — its photon/WASM codec can't ship in the single-file binary),
// so anything the composer lets through goes to the provider verbatim. Anthropic rejects a side over
// 8000px — and over 2000px once a request carries more than 20 images — and because history is re-sent
// every turn, ONE oversized attachment bricks the whole chat. Capping at 1568px (Claude's standard-tier
// long edge, beyond which it downsamples anyway) stays under every limit while losing nothing the model
// would actually see. Two more attach-time rules ride along: a media type outside png/jpeg/gif/webp
// (BMP, AVIF, HEIC…) is re-encoded even when within pixel bounds (the provider rejects the raw type),
// and anything over the provider's 4.5MB encoded-base64 ceiling (IMAGE_MAX_BASE64_BYTES — e.g. a multi-MB
// animated GIF that is dimensionally tiny) is re-encoded down a JPEG quality ladder. An undecodable
// file with a provider-unsupported type is refused outright (null) — raw pass-through would poison the
// session. The server-side `imageGuard` extension is the second line of defense for images that
// predate these rules or arrive by other routes.

import {
	ACCEPTED_IMAGE_TYPES,
	base64EncodedLength,
	IMAGE_MAX_BASE64_BYTES,
	type ImageContent,
} from "@thinkrail/contracts";

/** Claude's standard-tier long-edge; larger images are downsampled provider-side anyway. */
export const MAX_ATTACHMENT_EDGE = 1568;

/** The media types the provider accepts as-is (shared with the host's `imageGuard` via contracts);
 * anything else (BMP, AVIF, HEIC…) must be re-encoded even when its pixel size is already within
 * bounds — pi sends the attachment verbatim, so a raw `image/bmp` would 400 the request outright. */
const PROVIDER_ACCEPTED = new Set(ACCEPTED_IMAGE_TYPES);

/** The JPEG quality ladder for images whose encoding lands over IMAGE_MAX_BASE64_BYTES: tried
 * top-down, the first rung under the ceiling wins. At ≤1568px even the bottom rung is far below the
 * ceiling in practice; if
 * an adversarial image still exceeds it, the bottom rung is sent and the server-side `imageGuard`
 * remains the last line of defense. */
const JPEG_QUALITY_LADDER = [0.9, 0.8, 0.7, 0.6, 0.5];

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

function dataUrlToContent(dataUrl: string): ImageContent {
	const comma = dataUrl.indexOf(",");
	const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
	return { type: "image", data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mimeType };
}

function fileToRawContent(file: File): Promise<ImageContent> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
		// readAsDataURL yields `data:<type>;base64,…`, but `file.type` is the trusted source (a File's
		// data URL always carries its own type) — keep it authoritative and fall back like the parser.
		reader.onload = () =>
			resolve({ ...dataUrlToContent(String(reader.result)), mimeType: file.type || "image/png" });
		reader.readAsDataURL(file);
	});
}

/**
 * Turn a picked/pasted/dropped file into a composer attachment, downscaled to MAX_ATTACHMENT_EDGE when
 * its long edge exceeds it. An image passes through byte-identical (no re-encode, no quality loss)
 * only when ALL of: within pixel bounds, a provider-accepted media type (png/jpeg/gif/webp), and under
 * the provider's IMAGE_MAX_BASE64_BYTES ceiling (measured on the ENCODED base64 the wire actually
 * carries — pi caps it at 4.5MB, headroom under Anthropic's 5MB) — a within-bounds 12MB GIF or a small BMP is every bit as
 * session-poisoning as an 8000px side. Anything else goes through canvas: re-encoded in its own format
 * when canvas supports it (else PNG), then walked down the JPEG quality ladder while the encoding
 * exceeds the byte ceiling.
 *
 * Returns `null` when the file cannot be attached safely: the browser can't decode it AND its media
 * type is provider-unsupported — there is nothing to re-encode from, and sending the raw bytes (the
 * old fallback) would 400 the request and, once persisted, every later turn. A decode failure on an
 * ACCEPTED type still falls back to the raw bytes (the provider may well decode what the browser
 * can't; the server-side guard still bounds its size).
 */
export async function fileToAttachedImage(file: File): Promise<AttachedImage | null> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		if (!PROVIDER_ACCEPTED.has(file.type)) return null;
		return { content: await fileToRawContent(file) };
	}
	try {
		const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_ATTACHMENT_EDGE);
		const withinPixels = width === bitmap.width && height === bitmap.height;
		if (
			withinPixels &&
			PROVIDER_ACCEPTED.has(file.type) &&
			base64EncodedLength(file.size) <= IMAGE_MAX_BASE64_BYTES
		) {
			return { content: await fileToRawContent(file), width, height };
		}
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		// No 2d context (headless/limits): raw is safe only for a type the provider accepts.
		if (!ctx)
			return PROVIDER_ACCEPTED.has(file.type) ? { content: await fileToRawContent(file) } : null;
		ctx.drawImage(bitmap, 0, 0, width, height);
		const mimeType = CANVAS_ENCODABLE.has(file.type) ? file.type : "image/png";
		let content = dataUrlToContent(canvas.toDataURL(mimeType));
		for (const quality of JPEG_QUALITY_LADDER) {
			if (content.data.length <= IMAGE_MAX_BASE64_BYTES) break;
			content = dataUrlToContent(canvas.toDataURL("image/jpeg", quality));
		}
		return { content, width, height };
	} finally {
		bitmap.close();
	}
}
