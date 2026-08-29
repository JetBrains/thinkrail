import { ACCEPTED_IMAGE_TYPES, type ImageContent } from "@thinkrail/contracts";

const acceptedImageTypes = new Set(ACCEPTED_IMAGE_TYPES);

export interface ParsedToolResultContent {
	text: string;
	images: ImageContent[];
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

	const content = (result as { content: unknown }).content;
	if (!Array.isArray(content)) {
		return { text: toolValueText(result), images: [] };
	}

	const text: string[] = [];
	const images: ImageContent[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block as {
			type?: unknown;
			text?: unknown;
			data?: unknown;
			mimeType?: unknown;
		};
		if (candidate.type === "text" && typeof candidate.text === "string") {
			text.push(candidate.text);
			continue;
		}
		if (
			candidate.type === "image" &&
			typeof candidate.data === "string" &&
			candidate.data.length > 0 &&
			typeof candidate.mimeType === "string" &&
			acceptedImageTypes.has(candidate.mimeType)
		) {
			images.push({ type: "image", data: candidate.data, mimeType: candidate.mimeType });
		}
	}
	return { text: text.join(""), images };
}
