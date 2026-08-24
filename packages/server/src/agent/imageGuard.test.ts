import { describe, expect, test } from "bun:test";
import type { AgentMessage, ImageContent } from "@thinkrail/contracts";
import {
	guardOversizedImages,
	imageDimensions,
	isAnthropicFamilyModel,
	MANY_IMAGE_EDGE_LIMIT,
	MANY_IMAGE_THRESHOLD,
	oversizedImageGuard,
	SINGLE_IMAGE_EDGE_LIMIT,
} from "./imageGuard";

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
	const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
	const sof = Buffer.alloc(9);
	sof[0] = 0xff;
	sof[1] = 0xc0;
	sof.writeUInt16BE(7, 2);
	sof[4] = 8;
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

function webpRiff(chunk: string): Buffer {
	const b = Buffer.alloc(30);
	b.write("RIFF", 0, "ascii");
	b.writeUInt32LE(22, 4);
	b.write("WEBP", 8, "ascii");
	b.write(chunk, 12, "ascii");
	b.writeUInt32LE(10, 16);
	return b;
}

function webpVp8Bytes(width: number, height: number): Buffer {
	const b = webpRiff("VP8 ");
	b[23] = 0x9d;
	b[24] = 0x01;
	b[25] = 0x2a;
	b.writeUInt16LE(width, 26);
	b.writeUInt16LE(height, 28);
	return b;
}

function webpVp8lBytes(width: number, height: number): Buffer {
	const b = webpRiff("VP8L");
	b[20] = 0x2f;
	b.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
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

	test("reads lossy WebP (VP8) frame dimensions", () => {
		expect(imageDimensions(webpVp8Bytes(3200, 1400).toString("base64"))).toEqual({
			width: 3200,
			height: 1400,
		});
		const noSync = webpVp8Bytes(3200, 1400);
		noSync[23] = 0x00;
		expect(imageDimensions(noSync.toString("base64"))).toBeUndefined();
	});

	test("reads lossless WebP (VP8L) packed dimensions", () => {
		expect(imageDimensions(webpVp8lBytes(9000, 123).toString("base64"))).toEqual({
			width: 9000,
			height: 123,
		});
		expect(imageDimensions(webpVp8lBytes(16384, 1).toString("base64"))).toEqual({
			width: 16384,
			height: 1,
		});
		const badSig = webpVp8lBytes(9000, 123);
		badSig[20] = 0x30;
		expect(imageDimensions(badSig.toString("base64"))).toBeUndefined();
	});

	test("sniffs from a bounded prefix — a multi-MB payload after the header is never a problem", () => {
		const big = Buffer.concat([pngBytes(3024, 1964), Buffer.alloc(4 * 1024 * 1024, 0xab)]);
		expect(imageDimensions(big.toString("base64"))).toEqual({ width: 3024, height: 1964 });
	});

	test("a JPEG whose SOF lies beyond the sniff bound reads as undefined — never stripped blind", () => {
		const filler = Buffer.alloc(0xffff + 2);
		filler[0] = 0xff;
		filler[1] = 0xe1;
		filler.writeUInt16BE(0xffff, 2);
		const sof = Buffer.alloc(9);
		sof[0] = 0xff;
		sof[1] = 0xc0;
		sof.writeUInt16BE(7, 2);
		sof.writeUInt16BE(100, 5);
		sof.writeUInt16BE(200, 7);
		const jpeg = Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			...Array.from({ length: 5 }, () => filler),
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
		const big = image(pngBytes(2100, 1000));
		const messages: AgentMessage[] = [
			toolResult(Array.from({ length: MANY_IMAGE_THRESHOLD }, () => small)),
			user([big]),
		];
		const guarded = guardOversizedImages(messages);
		expect(guarded).toBeDefined();
		const tr = (guarded?.[0] as { content: { type: string }[] }).content;
		expect(tr.every((b) => b.type === "image")).toBe(true);
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

	test("strips an image over the 4.5MB encoded-base64 ceiling — dimensions within bounds, even unsniffable", () => {
		const hugeGif = Buffer.concat([gifBytes(1280, 960), Buffer.alloc(6 * 1024 * 1024, 0xab)]);
		const hugeMystery = Buffer.concat([
			Buffer.from("mystery-format"),
			Buffer.alloc(6 * 1024 * 1024, 0xcd),
		]);
		const guarded = guardOversizedImages([user([image(hugeGif, "image/gif"), image(hugeMystery)])]);
		expect(guarded).toBeDefined();
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		expect(content.every((b) => b.type === "text")).toBe(true);
		expect(content[0]?.text).toContain("4.5MB image payload limit");
		expect(content[1]?.text).toContain("4.5MB image payload limit");
	});

	test("strips an image whose DECODED size is under Anthropic's 5MB but whose base64 exceeds pi's 4.5MB cap", () => {
		const decoded = Buffer.concat([
			gifBytes(100, 100),
			Buffer.alloc(Math.round(3.6 * 1024 * 1024) - gifBytes(100, 100).length, 0xab),
		]);
		expect(decoded.length).toBeLessThan(5 * 1024 * 1024);
		expect(decoded.toString("base64").length).toBeGreaterThan(4.5 * 1024 * 1024);
		const guarded = guardOversizedImages([user([image(decoded, "image/gif")])]);
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		expect(content[0]?.text).toContain("4.5MB image payload limit");
	});

	test("strips a provider-unsupported media type even when small and within bounds — legacy HEIC/BMP heals", () => {
		const guarded = guardOversizedImages([
			user([
				image(Buffer.from("tiny-heic-payload"), "image/heic"),
				image(gifBytes(100, 100), "image/gif"),
			]),
		]);
		expect(guarded).toBeDefined();
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		expect(content[0]?.type).toBe("text");
		expect(content[0]?.text).toContain("media type image/heic is not supported");
		expect(content[1]?.type).toBe("image");
	});

	test("strips largest-first down to the request-wide 24MB image budget — each image alone is legal", () => {
		const mib = 1024 * 1024;
		const gif = (decodedBytes: number) =>
			image(
				Buffer.concat([
					gifBytes(100, 100),
					Buffer.alloc(decodedBytes - gifBytes(100, 100).length, 0xab),
				]),
				"image/gif",
			);
		const blocks = [3.1, 3.1, 3.1, 3.1, 3.1, 3.2, 3.3].map((m) => gif(Math.round(m * mib)));
		const guarded = guardOversizedImages([user(blocks)]);
		expect(guarded).toBeDefined();
		const content = (guarded?.[0] as { content: { type: string; text?: string }[] }).content;
		const stripped = content.filter((b) => b.type === "text");
		const kept = content.filter((b) => b.type === "image");
		expect(stripped.length).toBe(2);
		expect(kept.length).toBe(5);
		for (const note of stripped) expect(note.text).toContain("over the 24MB budget");
		const keptSizes = kept.map((b) => (b as { data?: string }).data?.length ?? 0);
		for (const size of keptSizes)
			expect(size).toBeLessThanOrEqual(Math.ceil((3.1 * mib) / 3) * 4 + 8);
	});

	test("keeps a request whose aggregate image payload is under the budget", () => {
		const mib = 1024 * 1024;
		const small = image(
			Buffer.concat([gifBytes(100, 100), Buffer.alloc(3 * mib, 0xab)]),
			"image/gif",
		);
		expect(guardOversizedImages([user([small, small, small])])).toBeUndefined();
	});

	test("keeps an image exactly at the encoded-base64 ceiling boundary", () => {
		const atLimit = Buffer.concat([
			gifBytes(100, 100),
			Buffer.alloc(3.375 * 1024 * 1024 - gifBytes(100, 100).length, 0xab),
		]);
		expect(atLimit.toString("base64").length).toBe(4.5 * 1024 * 1024);
		expect(guardOversizedImages([user([image(atLimit, "image/gif")])])).toBeUndefined();
	});

	test("re-evaluates the count-aware cap as it strips: largest-first, only down to the threshold", () => {
		const small = image(pngBytes(500, 500));
		const messages: AgentMessage[] = [
			toolResult(Array.from({ length: 18 }, () => small)),
			user([image(pngBytes(2600, 100)), image(pngBytes(2500, 100)), image(pngBytes(2400, 100))]),
		];
		const guarded = guardOversizedImages(messages);
		expect(guarded).toBeDefined();
		const tr = (guarded?.[0] as { content: { type: string }[] }).content;
		expect(tr.every((b) => b.type === "image")).toBe(true);
		const u = (guarded?.[1] as { content: { type: string; text?: string }[] }).content;
		expect(u[0]?.type).toBe("text");
		expect(u[0]?.text).toContain("2600×100");
		expect(u[1]?.type).toBe("image");
		expect(u[2]?.type).toBe("image");
	});

	test("does not mutate the input messages", () => {
		const original = user([image(pngBytes(9000, 9000))]);
		const snapshot = JSON.parse(JSON.stringify(original));
		guardOversizedImages([original]);
		expect(original).toEqual(snapshot);
	});
});

describe("isAnthropicFamilyModel", () => {
	test("matches native Anthropic and Claude-through-a-front, and nothing else", () => {
		expect(isAnthropicFamilyModel({ provider: "anthropic", api: "anthropic-messages" })).toBe(true);
		expect(
			isAnthropicFamilyModel({ provider: "amazon-bedrock", id: "anthropic.claude-sonnet" }),
		).toBe(true);
		expect(
			isAnthropicFamilyModel({ provider: "openai", api: "openai-responses", id: "gpt-5" }),
		).toBe(false);
		expect(isAnthropicFamilyModel({ provider: "google", id: "gemini-3-pro" })).toBe(false);
		expect(isAnthropicFamilyModel(undefined)).toBe(false);
	});
});

type ContextHandler = (
	event: { type: "context"; messages: AgentMessage[] },
	ctx: { model: { api?: string; provider?: string; id?: string } | undefined },
) => unknown;

function registeredHandler(): ContextHandler {
	let handler: ContextHandler | undefined;
	const pi = {
		on: (event: string, h: ContextHandler) => {
			if (event === "context") handler = h;
		},
	};
	oversizedImageGuard(pi as never);
	if (!handler) throw new Error("no context handler registered");
	return handler;
}

const anthropicCtx = { model: { provider: "anthropic", api: "anthropic-messages", id: "claude" } };

test("oversizedImageGuard registers a context handler that returns replaced messages", async () => {
	const handler = registeredHandler();

	const clean = await handler({ type: "context", messages: [user("hello")] }, anthropicCtx);
	expect(clean).toBeUndefined();

	const dirty = (await handler(
		{ type: "context", messages: [user([image(pngBytes(9000, 100))])] },
		anthropicCtx,
	)) as { messages: AgentMessage[] };
	expect(dirty?.messages).toBeDefined();
});

test("the guard is a no-op for a non-Anthropic model — the caps are Anthropic's, not the provider's", async () => {
	const handler = registeredHandler();
	const oversized = { type: "context" as const, messages: [user([image(pngBytes(9000, 100))])] };

	expect(
		await handler(oversized, {
			model: { provider: "openai", api: "openai-responses", id: "gpt-5" },
		}),
	).toBeUndefined();
	expect(await handler(oversized, { model: undefined })).toBeUndefined();
});
