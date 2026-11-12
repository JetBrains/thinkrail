import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ACCEPTED_IMAGE_TYPES,
	type AgentMessage,
	IMAGE_MAX_BASE64_BYTES,
} from "@thinkrail/contracts";
import { type Dimensions, imageDimensions } from "../images";

export const SINGLE_IMAGE_EDGE_LIMIT = 8000;
export const MANY_IMAGE_EDGE_LIMIT = 2000;
export const MANY_IMAGE_THRESHOLD = 20;
export const CONTEXT_IMAGE_BASE64_BUDGET = 24 * 1024 * 1024;

type ContentBlock = { type: string } & Record<string, unknown>;

const isImageBlock = (block: ContentBlock): block is ContentBlock & { data: string } =>
	block.type === "image" && typeof block.data === "string";

const REMOVAL_HINT = "ask the user to re-attach a smaller version if it is still needed";

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
const mbLimit = (bytes: number) => `${bytes / (1024 * 1024)}MB`;

export function guardOversizedImages(messages: AgentMessage[]): AgentMessage[] | undefined {
	const blocksOf = (m: AgentMessage): ContentBlock[] | undefined => {
		const content = (m as { content?: unknown }).content;
		return Array.isArray(content) ? (content as ContentBlock[]) : undefined;
	};

	const sniffed = new Map<ContentBlock, Dimensions | undefined>();
	const imageBlocks: (ContentBlock & { data: string })[] = [];
	for (const message of messages) {
		for (const block of blocksOf(message) ?? []) {
			if (isImageBlock(block)) {
				imageBlocks.push(block);
				sniffed.set(block, imageDimensions(block.data));
			}
		}
	}
	if (imageBlocks.length === 0) return undefined;

	const notes = new Map<ContentBlock, string>();
	for (const block of imageBlocks) {
		const mimeType = (block as { mimeType?: unknown }).mimeType;
		if (typeof mimeType === "string" && !ACCEPTED_IMAGE_TYPES.includes(mimeType)) {
			notes.set(
				block,
				`[image removed: media type ${mimeType} is not supported by the provider (accepted: ${ACCEPTED_IMAGE_TYPES.join(", ")}) — ${REMOVAL_HINT}]`,
			);
			continue;
		}
		if (block.data.length > IMAGE_MAX_BASE64_BYTES) {
			notes.set(
				block,
				`[image removed: ${mb(block.data.length)} of base64 exceeds the provider's ${mbLimit(IMAGE_MAX_BASE64_BYTES)} image payload limit — ${REMOVAL_HINT}]`,
			);
			continue;
		}
		const d = sniffed.get(block);
		if (d && (d.width > SINGLE_IMAGE_EDGE_LIMIT || d.height > SINGLE_IMAGE_EDGE_LIMIT)) {
			notes.set(
				block,
				`[image removed: ${d.width}×${d.height} exceeds the provider's ${SINGLE_IMAGE_EDGE_LIMIT}px image-dimension limit — ${REMOVAL_HINT}]`,
			);
		}
	}

	let surviving = imageBlocks.length - notes.size;
	if (surviving > MANY_IMAGE_THRESHOLD) {
		const longEdge = (b: ContentBlock) => {
			const d = sniffed.get(b);
			return d ? Math.max(d.width, d.height) : 0;
		};
		const strictViolators = imageBlocks
			.filter((b) => !notes.has(b) && longEdge(b) > MANY_IMAGE_EDGE_LIMIT)
			.sort((a, b) => longEdge(b) - longEdge(a));
		for (const block of strictViolators) {
			if (surviving <= MANY_IMAGE_THRESHOLD) break;
			const d = sniffed.get(block);
			notes.set(
				block,
				`[image removed: ${d?.width}×${d?.height} exceeds the provider's ${MANY_IMAGE_EDGE_LIMIT}px image-dimension limit for requests carrying more than ${MANY_IMAGE_THRESHOLD} images — ${REMOVAL_HINT}]`,
			);
			surviving--;
		}
	}

	const survivors = imageBlocks.filter((b) => !notes.has(b));
	let totalBytes = survivors.reduce((sum, b) => sum + b.data.length, 0);
	if (totalBytes > CONTEXT_IMAGE_BASE64_BUDGET) {
		const bySize = [...survivors].sort((a, b) => b.data.length - a.data.length);
		for (const block of bySize) {
			if (totalBytes <= CONTEXT_IMAGE_BASE64_BUDGET) break;
			notes.set(
				block,
				`[image removed: ${mb(block.data.length)} of base64 pushed the request's total image payload over the ${mbLimit(CONTEXT_IMAGE_BASE64_BUDGET)} budget (the provider caps the whole request) — ${REMOVAL_HINT}]`,
			);
			totalBytes -= block.data.length;
		}
	}
	if (notes.size === 0) return undefined;

	const guarded = messages.map((message) => {
		const blocks = blocksOf(message);
		if (!blocks?.some((b) => notes.has(b))) return message;
		const content = blocks.map((block) => {
			const note = notes.get(block);
			return note ? { type: "text", text: note } : block;
		});
		return Object.assign({}, message, { content });
	});
	return guarded;
}

export function isAnthropicFamilyModel(
	model: { api?: string; provider?: string; id?: string } | undefined,
): boolean {
	if (!model) return false;
	if (model.provider === "anthropic" || model.api === "anthropic-messages") return true;
	return /claude/i.test(model.id ?? "");
}

export function oversizedImageGuard(pi: ExtensionAPI): void {
	pi.on("context", (event, ctx) => {
		if (!isAnthropicFamilyModel(ctx.model)) return undefined;
		const messages = guardOversizedImages(event.messages);
		return messages ? { messages } : undefined;
	});
}
