import {
	ACCEPTED_IMAGE_TYPES,
	base64EncodedLength,
	IMAGE_MAX_BASE64_BYTES,
	type ImageContent,
} from "@thinkrail/contracts";

export const MAX_ATTACHMENT_EDGE = 1568;

const PROVIDER_ACCEPTED = new Set(ACCEPTED_IMAGE_TYPES);

const JPEG_QUALITY_LADDER = [0.9, 0.8, 0.7, 0.6, 0.5];

export interface AttachedImage {
	content: ImageContent;
	width?: number;
	height?: number;
}

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
		reader.onload = () =>
			resolve({ ...dataUrlToContent(String(reader.result)), mimeType: file.type || "image/png" });
		reader.readAsDataURL(file);
	});
}

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
