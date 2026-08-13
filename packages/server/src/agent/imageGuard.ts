// Oversized-image guard (TASK-image-attachment-downscale): the un-bricking half of the image-size fix.
// Anthropic caps an image side at 8000px — dropping to 2000px once a single request carries more than
// 20 images — and pi re-sends the whole history every turn, so ONE oversized image (a pre-fix
// attachment, or a raw `read` of a huge file — `images.autoResize:false` sends read-tool images
// verbatim) permanently 400s the session. Sessions are append-only ("pi owns state") and the host has
// no image codec (the same photon/WASM bundling problem that disabled autoResize), so the guard
// transforms the OUTGOING context instead: on pi's `context` event (fired before every LLM call, live
// sessions included — a stuck chat unsticks on its very next message) it sniffs each image's dimensions
// straight from the base64 header bytes and replaces violating image blocks with a text note. The
// session file and the visible transcript stay untouched. The caps are Anthropic's model-level rules,
// so the guard fires ONLY for the Anthropic model family (the `context` handler's ctx.model — native
// `anthropic-messages` api / `anthropic` provider, or a Claude model served through Bedrock/Vertex);
// other providers keep their full image context untouched. The count-aware cap also self-heals the
// read-tool case — a raw 3000px file read is legal while the context holds ≤20 images and degrades to
// a note (not a brick) once the same session crosses 21.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@thinkrail/contracts";

/** Anthropic's per-side cap for requests carrying 20 images or fewer. */
export const SINGLE_IMAGE_EDGE_LIMIT = 8000;
/** Anthropic's stricter per-side cap once a request carries more than MANY_IMAGE_THRESHOLD images. */
export const MANY_IMAGE_EDGE_LIMIT = 2000;
/** Image count above which the stricter cap applies. */
export const MANY_IMAGE_THRESHOLD = 20;

interface Dimensions {
	width: number;
	height: number;
}

function pngDimensions(b: Buffer): Dimensions | undefined {
	// 8-byte signature, 4-byte length, "IHDR", then 4-byte width + height (big-endian).
	if (b.length < 24) return undefined;
	if (b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return undefined;
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegDimensions(b: Buffer): Dimensions | undefined {
	// SOI, then walk marker segments to the first SOFn frame header (0xC0–0xCF minus C4/C8/CC).
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
	let off = 2;
	while (off + 9 <= b.length) {
		if (b[off] !== 0xff) return undefined;
		const marker = b[off + 1] ?? 0;
		if (marker === 0xff) {
			off++; // fill byte
			continue;
		}
		const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
		if (isSof) return { width: b.readUInt16BE(off + 7), height: b.readUInt16BE(off + 5) };
		if (marker === 0xd9 || marker === 0xda) return undefined; // EOI / entropy-coded data — no SOF seen
		off += 2 + b.readUInt16BE(off + 2);
	}
	return undefined;
}

function gifDimensions(b: Buffer): Dimensions | undefined {
	// "GIF87a"/"GIF89a", then logical screen width + height (little-endian).
	if (b.length < 10 || b.toString("ascii", 0, 3) !== "GIF") return undefined;
	return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpDimensions(b: Buffer): Dimensions | undefined {
	if (
		b.length < 30 ||
		b.toString("ascii", 0, 4) !== "RIFF" ||
		b.toString("ascii", 8, 12) !== "WEBP"
	)
		return undefined;
	const chunk = b.toString("ascii", 12, 16);
	if (chunk === "VP8X") {
		// Canvas size: 24-bit little-endian width-1 / height-1 after the 4-byte flags field.
		return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
	}
	if (chunk === "VP8 ") {
		// Lossy: frame tag, then 0x9D 0x01 0x2A, then 14-bit little-endian width / height.
		if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
		return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === "VP8L") {
		// Lossless: signature 0x2F, then 14-bit width-1 / height-1 packed little-endian.
		if (b[20] !== 0x2f) return undefined;
		const bits = b.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	return undefined;
}

/** How many decoded bytes the sniffer may look at. PNG/GIF/WebP dimensions sit at fixed offsets in the
 * first ~30 bytes; only JPEG walks marker segments, and its metadata segments (EXIF, thumbnails) cap at
 * 64KiB each — 256KiB of prefix covers real-world files with several of them. The bound is the point:
 * the guard runs on pi's `context` hook before EVERY LLM call in the in-process host, so decoding whole
 * multi-MB images there would be an unbounded allocation per turn. A JPEG whose SOF lies beyond the
 * bound sniffs as undefined — "couldn't sniff", never stripped blind. */
const MAX_SNIFF_BYTES = 256 * 1024;
// base64 quantum is 4 chars → 3 bytes; keep the prefix on a 4-char boundary so the slice decodes clean.
const MAX_SNIFF_BASE64_CHARS = Math.ceil(MAX_SNIFF_BYTES / 3) * 4;

/** Sniff an image's pixel dimensions from its base64 data (PNG / JPEG / GIF / WebP header bytes — no
 * codec, and only a bounded prefix is ever decoded). Undefined for unrecognized or malformed data: the
 * guard never strips blind. */
export function imageDimensions(base64: string): Dimensions | undefined {
	if (!base64) return undefined;
	let bytes: Buffer;
	try {
		bytes = Buffer.from(base64.slice(0, MAX_SNIFF_BASE64_CHARS), "base64");
	} catch {
		return undefined;
	}
	if (bytes.length < 10) return undefined;
	try {
		return (
			pngDimensions(bytes) ?? jpegDimensions(bytes) ?? gifDimensions(bytes) ?? webpDimensions(bytes)
		);
	} catch {
		return undefined; // truncated header — a read past the buffer is "couldn't sniff", not a crash
	}
}

type ContentBlock = { type: string } & Record<string, unknown>;

const isImageBlock = (block: ContentBlock): block is ContentBlock & { data: string } =>
	block.type === "image" && typeof block.data === "string";

/**
 * Replace every image block that exceeds the provider's per-side cap with a text note carrying its
 * dimensions (copy-on-write — the input is never mutated). The cap is count-aware: 8000px normally,
 * 2000px when the whole context carries more than 20 images. Returns undefined when nothing changed.
 */
export function guardOversizedImages(messages: AgentMessage[]): AgentMessage[] | undefined {
	const blocksOf = (m: AgentMessage): ContentBlock[] | undefined => {
		const content = (m as { content?: unknown }).content;
		return Array.isArray(content) ? (content as ContentBlock[]) : undefined;
	};

	// One bounded sniff per image block per pass, cached by block identity — the hook fires on every LLM
	// call, so re-decoding per predicate (count / detect / note text) would multiply the work.
	const sniffed = new Map<ContentBlock, Dimensions | undefined>();
	let imageCount = 0;
	for (const message of messages) {
		for (const block of blocksOf(message) ?? []) {
			if (isImageBlock(block)) {
				imageCount++;
				sniffed.set(block, imageDimensions(block.data));
			}
		}
	}
	if (imageCount === 0) return undefined;
	const cap = imageCount > MANY_IMAGE_THRESHOLD ? MANY_IMAGE_EDGE_LIMIT : SINGLE_IMAGE_EDGE_LIMIT;

	const exceeds = (block: ContentBlock): boolean => {
		const d = sniffed.get(block);
		return d !== undefined && (d.width > cap || d.height > cap);
	};

	let changed = false;
	const guarded = messages.map((message) => {
		const blocks = blocksOf(message);
		if (!blocks?.some(exceeds)) return message;
		changed = true;
		const content = blocks.map((block) => {
			if (!exceeds(block)) return block;
			const d = sniffed.get(block);
			return {
				type: "text",
				text: `[image removed: ${d ? `${d.width}×${d.height}` : "unknown size"} exceeds the provider's ${cap}px image-dimension limit — ask the user to re-attach a smaller version if it is still needed]`,
			};
		});
		// Object.assign keeps the concrete message variant (its type is `message & {content}`), which
		// widens back to AgentMessage without a lossy double-cast.
		return Object.assign({}, message, { content }) as AgentMessage;
	});
	return changed ? guarded : undefined;
}

/** Does this model enforce Anthropic's image-dimension rules? Native Anthropic (api/provider), plus
 * Claude models reached through an aggregator or cloud front (Bedrock/Vertex/OpenRouter expose them
 * under their own provider ids — the model id still names claude). Undefined model ⇒ false: without a
 * known policy the guard must not strip anything. */
export function isAnthropicFamilyModel(
	model: { api?: string; provider?: string; id?: string } | undefined,
): boolean {
	if (!model) return false;
	if (model.provider === "anthropic" || model.api === "anthropic-messages") return true;
	return /claude/i.test(model.id ?? "");
}

/** The inline pi extension: registered in `buildResourceLoader`'s shared factories, so every session —
 * live or reopened — gets its outgoing context guarded on each LLM call. The dimension caps are
 * Anthropic's, so the guard is a no-op for every other model family. */
export function oversizedImageGuard(pi: ExtensionAPI): void {
	pi.on("context", (event, ctx) => {
		if (!isAnthropicFamilyModel(ctx.model)) return undefined;
		const messages = guardOversizedImages(event.messages);
		return messages ? { messages } : undefined;
	});
}
