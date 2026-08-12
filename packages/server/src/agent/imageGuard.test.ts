import { describe, expect, test } from "bun:test";
import type { AgentMessage, ImageContent } from "@thinkrail/contracts";
import {
	guardOversizedImages,
	imageDimensions,
	MANY_IMAGE_EDGE_LIMIT,
	MANY_IMAGE_THRESHOLD,
	oversizedImageGuard,
	SINGLE_IMAGE_EDGE_LIMIT,
} from "./imageGuard";

// The un-bricking half of TASK-image-attachment-downscale: an oversized image anywhere in a session's
// history re-fails EVERY turn (Anthropic caps a side at 8000px, dropping to 2000px once a request
// carries more than 20 images). Sessions are append-only and the host has no image codec, so the guard
// transforms the OUTGOING context (pi's `context` extension event) — sniffing dimensions straight from
// the base64 header bytes and replacing violating image blocks with a text note — while the session
// file and transcript stay untouched.

// ---- tiny hand-built image headers (only the bytes the sniffer reads) ----

function pngBytes(width: number, height: number): Buffer {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(21);
	ihdr.writeUInt32BE(13, 0);
	ihdr.write("IHDR", 4);
	ihdr.writeUInt32BE(width, 8);
	ihdr.writeUInt32BE(height, 12);
	return Buffer.concat([sig, ihdr]);
}

function jpegBytes(width: number, height: number): Buffer {
	const soi = Buffer.from([0xff, 0xd8]);
	// An APP0 segment before the SOF, so the sniffer must actually walk segments.
	const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
	const sof = Buffer.alloc(9);
	sof[0] = 0xff;
	sof[1] = 0xc0; // SOF0
	sof.writeUInt16BE(7, 2);
	sof[4] = 8; // bit depth
	sof.writeUInt16BE(height, 5);
	sof.writeUInt16BE(width, 7);
	return Buffer.concat([soi, app0, sof]);
}

function gifBytes(width: number, height: number): Buffer {
	const b = Buffer.alloc(10);
	b.write("GIF89a", 0, "ascii");
	b.writeUInt16LE(width, 6);
	b.writeUInt16LE(height, 8);
	return b;
}

function webpBytes(width: number, height: number): Buffer {
	const b = Buffer.alloc(30);
	b.write("RIFF", 0, "ascii");
	b.writeUInt32LE(22, 4);
	b.write("WEBP", 8, "ascii");
	b.write("VP8X", 12, "ascii");
	b.writeUInt32LE(10, 16);
	b.writeUIntLE(width - 1, 24, 3);
	b.writeUIntLE(height - 1, 27, 3);
	return b;
}

const image = (bytes: Buffer, mimeType = "image/png"): ImageContent => ({
	type: "image",
	data: bytes.toString("base64"),
	mimeType,
});

const user = (content: string | (ImageContent | { type: "text"; text: string })[]): AgentMessage =>
	({ role: "user", content, timestamp: 1 }) as AgentMessage;

const toolResult = (content: (ImageContent | { type: "text"; text: string })[]) =>
	({
		role: "toolResult",
		toolCallId: "tc1",
		toolName: "read",
		content,
		isError: false,
		timestamp: 1,
	}) as AgentMessage;

// ---- imageDimensions: header sniffing, no codec ----

describe("imageDimensions", () => {
	test("reads PNG IHDR dimensions", () => {
		expect(imageDimensions(pngBytes(3024, 1964).toString("base64"))).toEqual({
			width: 3024,
			height: 1964,
		});
	});

	test("walks JPEG segments to the SOF frame header", () => {
		expect(imageDimensions(jpegBytes(4032, 3024).toString("base64"))).toEqual({
			width: 4032,
			height: 3024,
		});
	});

	test("reads GIF logical screen dimensions", () => {
		expect(imageDimensions(gifBytes(2500, 900).toString("base64"))).toEqual({
			width: 2500,
			height: 900,
		});
	});

	test("reads WebP VP8X canvas dimensions", () => {
		expect(imageDimensions(webpBytes(2600, 2200).toString("base64"))).toEqual({
			width: 2600,
			height: 2200,
		});
	});

	test("sniffs from a bounded prefix — a multi-MB payload after the header is never a problem", () => {
		// The guard runs on every LLM call; only the header region is decoded, so trailing image data
		// (the actual pixels) beyond the 256KiB sniff bound must not affect the result.
		const big = Buffer.concat([pngBytes(3024, 1964), Buffer.alloc(4 * 1024 * 1024, 0xab)]);
		expect(imageDimensions(big.toString("base64"))).toEqual({ width: 3024, height: 1964 });
	});

	test("a JPEG whose SOF lies beyond the sniff bound reads as undefined — never stripped blind", () => {
		// SOI + a chain of max-size APP1 segments pushing the SOF past 256KiB of decoded bytes.
		const filler = Buffer.alloc(0xffff + 2);
		filler[0] = 0xff;
		filler[1] = 0xe1; // APP1
		filler.writeUInt16BE(0xffff, 2);
		const sof = Buffer.alloc(9);
		sof[0] = 0xff;
		sof[1] = 0xc0;
		sof.writeUInt16BE(7, 2);
		sof.writeUInt16BE(100, 5);
		sof.writeUInt16BE(200, 7);
		const jpeg = Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			...Array.from({ length: 5 }, () => filler), // ~320KiB of metadata before the SOF
			sof,
		]);
		expect(imageDimensions(jpeg.toString("base64"))).toBeUndefined();
	});

	test("returns undefined for unrecognized bytes and invalid base64", () => {
		expect(imageDimensions(Buffer.from("not an image at all").toString("base64"))).toBeUndefined();
		expect(imageDimensions("!!!not-base64!!!")).toBeUndefined();
		expect(imageDimensions("")).toBeUndefined();
	});
});

// ---- guardOversizedImages: the context transform ----

describe("guardOversizedImages", () => {
	test("keeps a 2000–8000px image while the context holds few images", () => {
		const messages = [user([{ type: "text", text: "look" }, image(pngBytes(3000, 2000))])];
		expect(guardOversizedImages(messages)).toBeUndefined();
	});

	test("always strips an image over the 8000px hard cap", () => {
		const messages = [user([image(pngBytes(9000, 100))])];
		const guarded = guardOversizedImages(messages);
		expect(guarded).toBeDefined();
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		expect(content).toHaveLength(1);
		expect(content[0]?.type).toBe("text");
		expect(content[0]?.text).toContain("9000×100");
		expect(content[0]?.text).toContain(`${SINGLE_IMAGE_EDGE_LIMIT}px`);
	});

	test("applies the stricter 2000px cap once the context carries more than 20 images", () => {
		const small = image(pngBytes(100, 100));
		const big = image(pngBytes(2100, 1000)); // legal alone, illegal in a many-image request
		const messages: AgentMessage[] = [
			toolResult(Array.from({ length: MANY_IMAGE_THRESHOLD }, () => small)),
			user([big]),
		];
		const guarded = guardOversizedImages(messages);
		expect(guarded).toBeDefined();
		// The 20 small images survive untouched…
		const tr = (guarded?.[0] as { content: { type: string }[] }).content;
		expect(tr.every((b) => b.type === "image")).toBe(true);
		// …the 21st, oversized one becomes a text note naming the stricter cap.
		const u = (guarded?.[1] as { content: { type: string; text?: string }[] }).content;
		expect(u[0]?.type).toBe("text");
		expect(u[0]?.text).toContain(`${MANY_IMAGE_EDGE_LIMIT}px`);
	});

	test("the same 2100px image is kept while the context holds 20 images or fewer", () => {
		const small = image(pngBytes(100, 100));
		const messages: AgentMessage[] = [
			toolResult(Array.from({ length: MANY_IMAGE_THRESHOLD - 1 }, () => small)),
			user([image(pngBytes(2100, 1000))]),
		];
		expect(guardOversizedImages(messages)).toBeUndefined();
	});

	test("strips oversized images inside tool results too", () => {
		const messages = [
			toolResult([{ type: "text", text: "read it" }, image(jpegBytes(9500, 200), "image/jpeg")]),
		];
		const guarded = guardOversizedImages(messages);
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		expect(content[0]).toEqual({ type: "text", text: "read it" });
		expect(content[1]?.type).toBe("text");
		expect(content[1]?.text).toContain("9500×200");
	});

	test("no-ops (returns undefined) when nothing is oversized", () => {
		const messages: AgentMessage[] = [
			user("plain string content"),
			user([{ type: "text", text: "hi" }, image(pngBytes(1568, 882))]),
			toolResult([{ type: "text", text: "ok" }]),
		];
		expect(guardOversizedImages(messages)).toBeUndefined();
	});

	test("leaves an image with unsniffable bytes untouched (never strips blind)", () => {
		const messages = [user([image(Buffer.from("mystery-format"))])];
		expect(guardOversizedImages(messages)).toBeUndefined();
	});

	test("does not mutate the input messages", () => {
		const original = user([image(pngBytes(9000, 9000))]);
		const snapshot = JSON.parse(JSON.stringify(original));
		guardOversizedImages([original]);
		expect(original).toEqual(snapshot);
	});
});

// ---- the extension wiring ----

test("oversizedImageGuard registers a context handler that returns replaced messages", async () => {
	let handler: ((event: { type: "context"; messages: AgentMessage[] }) => unknown) | undefined;
	const pi = {
		on: (event: string, h: typeof handler) => {
			if (event === "context") handler = h;
		},
	};
	oversizedImageGuard(pi as never);
	expect(handler).toBeDefined();

	const clean = await handler?.({ type: "context", messages: [user("hello")] });
	expect(clean).toBeUndefined();

	const dirty = (await handler?.({
		type: "context",
		messages: [user([image(pngBytes(9000, 100))])],
	})) as { messages: AgentMessage[] };
	expect(dirty?.messages).toBeDefined();
});
