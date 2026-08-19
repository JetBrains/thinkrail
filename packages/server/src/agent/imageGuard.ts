// Oversized-image guard (TASK-image-attachment-downscale): the un-bricking half of the image-size fix.
// Anthropic caps an image side at 8000px — dropping to 2000px once a single request carries more than
// 20 images — and pi re-sends the whole history every turn, so ONE oversized image (a pre-fix
// attachment, or a raw `read` of a huge file — `images.autoResize:false` sends read-tool images
// verbatim) permanently 400s the session. Sessions are append-only ("pi owns state") and the host has
// no image codec (the same photon/WASM bundling problem that disabled autoResize), so the guard
// transforms the OUTGOING context instead: on pi's `context` event (fired before every LLM call, live
// sessions included — a stuck chat unsticks on its very next message) it sniffs each image's dimensions
// straight from the base64 header bytes, measures its byte size from the base64 length (the provider
// also caps an image at 4.5MB of base64 — IMAGE_MAX_BASE64_BYTES, shared with the composer's attach-time
// ladder — the whole request at 32MB — REQUEST_IMAGE_BASE64_BUDGET keeps 24MB of it for images — and
// rejects media types outside png/jpeg/gif/webp — ACCEPTED_IMAGE_TYPES), and
// replaces violating image blocks with a text note. The
// session file and the visible transcript stay untouched. The caps are Anthropic's model-level rules,
// so the guard fires ONLY for the Anthropic model family (the `context` handler's ctx.model — native
// `anthropic-messages` api / `anthropic` provider, or a Claude model served through Bedrock/Vertex);
// other providers keep their full image context untouched. The count-aware cap also self-heals the
// read-tool case — a raw 3000px file read is legal while the context holds ≤20 images and degrades to
// a note (not a brick) once the same session crosses 21.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ACCEPTED_IMAGE_TYPES,
	type AgentMessage,
	IMAGE_MAX_BASE64_BYTES,
	REQUEST_IMAGE_BASE64_BUDGET,
} from "@thinkrail/contracts";

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

const REMOVAL_HINT = "ask the user to re-attach a smaller version if it is still needed";

/** Byte count → the "NMB" text the removal notes carry (one decimal for measurements, exact for limits). */
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
const mbLimit = (bytes: number) => `${bytes / (1024 * 1024)}MB`;

/**
 * Replace every image block that violates a provider limit with a text note naming the violated rule
 * (copy-on-write — the input is never mutated). Five rules, applied in order:
 * 1. media type — anything outside ACCEPTED_IMAGE_TYPES (BMP, AVIF, HEIC…) is stripped: pi forwards
 *    the type verbatim and the provider rejects the whole request (heals sessions poisoned before the
 *    composer refused such files);
 * 2. bytes — anything whose base64 payload (`data.length` — what the wire actually carries) exceeds
 *    IMAGE_MAX_BASE64_BYTES (4.5MB, pi's own headroom under Anthropic's 5MB) is stripped, sniffable or not;
 * 3. the 8000px hard per-side cap;
 * 4. the count-aware 2000px cap — and because stripping changes the very count that selects the cap,
 *    2000px violators are stripped LARGEST-FIRST only until the surviving image count is back at the
 *    20-image threshold; the rest are then legal under the 8000px cap and stay (18 small + 3 at
 *    2500px ⇒ one stripped, not three);
 * 5. the request-wide REQUEST_IMAGE_BASE64_BUDGET (24MB, headroom under Anthropic's 32MB per-request
 *    cap) — several images each under the per-image ceiling can still overflow the whole request, so
 *    survivors are stripped LARGEST-FIRST until the aggregate encoded payload fits.
 * Returns undefined when nothing changed.
 */
export function guardOversizedImages(messages: AgentMessage[]): AgentMessage[] | undefined {
	const blocksOf = (m: AgentMessage): ContentBlock[] | undefined => {
		const content = (m as { content?: unknown }).content;
		return Array.isArray(content) ? (content as ContentBlock[]) : undefined;
	};

	// One bounded sniff per image block per pass, cached by block identity — the hook fires on every LLM
	// call, so re-decoding per predicate (count / detect / note text) would multiply the work.
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

	// The removal note per stripped block — membership doubles as the strip decision.
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
		// base64 is ASCII: string length IS the encoded byte length — the size the provider sees.
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

	// The stricter cap only applies while the request still carries more than the threshold — each strip
	// lowers the count, so strip largest-first and stop the moment the survivors fit under the threshold
	// (the rest become legal under the 8000px cap already enforced above).
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

	// Rule 5: the whole request must fit — per-image-legal blocks can still sum past the provider's
	// request cap, and a persisted overflow rejects every later turn. Largest-first keeps the most
	// images for the budget spent.
	const survivors = imageBlocks.filter((b) => !notes.has(b));
	let totalBytes = survivors.reduce((sum, b) => sum + b.data.length, 0);
	if (totalBytes > REQUEST_IMAGE_BASE64_BUDGET) {
		const bySize = [...survivors].sort((a, b) => b.data.length - a.data.length);
		for (const block of bySize) {
			if (totalBytes <= REQUEST_IMAGE_BASE64_BUDGET) break;
			notes.set(
				block,
				`[image removed: ${mb(block.data.length)} of base64 pushed the request's total image payload over the ${mbLimit(REQUEST_IMAGE_BASE64_BUDGET)} budget (the provider caps the whole request) — ${REMOVAL_HINT}]`,
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
		// Object.assign keeps the concrete message variant (its type is `message & {content}`), which
		// widens back to AgentMessage without a lossy double-cast.
		return Object.assign({}, message, { content }) as AgentMessage;
	});
	return guarded;
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
