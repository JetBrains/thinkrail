import { ACCEPTED_IMAGE_TYPES, IMAGES_ROUTE, type WireImage } from "@thinkrail/contracts";

const acceptedImageTypes = new Set(ACCEPTED_IMAGE_TYPES);

export interface ParsedToolResultContent {
	text: string;
	images: WireImage[];
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function imageOf(candidate: {
	data?: unknown;
	mimeType?: unknown;
	ref?: unknown;
	width?: unknown;
	height?: unknown;
}): WireImage | null {
	const { mimeType } = candidate;
	if (typeof mimeType !== "string" || !acceptedImageTypes.has(mimeType)) return null;
	if (typeof candidate.ref === "string" && candidate.ref.startsWith(IMAGES_ROUTE)) {
		const sized = positiveInteger(candidate.width) && positiveInteger(candidate.height);
		return {
			type: "image",
			mimeType,
			ref: candidate.ref,
			...(sized ? { width: candidate.width as number, height: candidate.height as number } : {}),
		};
	}
	if (typeof candidate.data === "string" && candidate.data.length > 0) {
		return { type: "image", data: candidate.data, mimeType };
	}
	return null;
}

export function toolValueText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function parseToolResultContent(result: unknown): ParsedToolResultContent {
	if (result == null || typeof result === "string") {
		return { text: toolValueText(result), images: [] };
	}
	if (typeof result !== "object" || !("content" in result)) {
		return { text: toolValueText(result), images: [] };
	}

	const content = result.content;
	if (!Array.isArray(content)) {
		return { text: toolValueText(result), images: [] };
	}

	const text: string[] = [];
	const images: WireImage[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block as {
			type?: unknown;
			text?: unknown;
			data?: unknown;
			mimeType?: unknown;
			ref?: unknown;
			width?: unknown;
			height?: unknown;
		};
		if (candidate.type === "text" && typeof candidate.text === "string") {
			text.push(candidate.text);
			continue;
		}
		if (candidate.type !== "image") continue;
		const image = imageOf(candidate);
		if (image) images.push(image);
	}
	return { text: text.join(""), images };
}
