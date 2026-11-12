import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IMAGES_ROUTE, type RefImage } from "@thinkrail/contracts";
import {
	forgetImageSession,
	type ImageBlock,
	type ImageSource,
	imageRefHash,
	projectImages,
	resetImages,
	serveImage,
	setImageSource,
} from "./index";

function pngBytes(width: number, height: number): Buffer {
	const bytes = Buffer.alloc(64);
	bytes.writeUInt32BE(0x89504e47, 0);
	bytes.writeUInt32BE(0x0d0a1a0a, 4);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

function png(width = 800, height = 600, salt = ""): ImageBlock {
	const bytes = Buffer.concat([pngBytes(width, height), Buffer.from(salt)]);
	return { type: "image", data: bytes.toString("base64"), mimeType: "image/png" };
}

const SESSION = "01a1ced7-6270-70ac-9e3d-b7e2afc89d53";
const blocks = new Map<string, ImageBlock[]>();
const deleted = new Set<string>();
const source: ImageSource = {
	isServable: (sessionId) => !deleted.has(sessionId),
	find: (sessionId, hash) =>
		blocks.get(sessionId)?.find((block) => imageRefHash(block) === hash) ?? null,
};

beforeEach(() => {
	resetImages();
	setImageSource(source);
});

afterEach(() => {
	blocks.clear();
	deleted.clear();
	resetImages();
});

function refOf(value: unknown): RefImage {
	return value as RefImage;
}

describe("projectImages", () => {
	test("swaps an image block for a sized reference and never mutates the input", () => {
		const image = png(800, 600);
		const message = { role: "toolResult", content: [{ type: "text", text: "shot" }, image] };
		const projected = projectImages(message, SESSION) as typeof message;

		expect(message.content[1]).toBe(image);
		expect(projected).not.toBe(message);
		expect(projected.content[0]).toBe(message.content[0]);
		const ref = refOf(projected.content[1]);
		expect(ref).toEqual({
			type: "image",
			mimeType: "image/png",
			ref: `${IMAGES_ROUTE}${SESSION}/${imageRefHash(image)}`,
			width: 800,
			height: 600,
		});
		expect("data" in ref).toBe(false);
	});

	test("returns values without images unchanged by identity", () => {
		const event = {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text" }] },
		};
		expect(projectImages(event, SESSION)).toBe(event);
		expect(projectImages("text", SESSION)).toBe("text");
		expect(projectImages(null, SESSION)).toBeNull();
	});

	test("dedupes every echo of one block to one reference, shared or repeated", () => {
		const image = png();
		const toolResult = { role: "toolResult", content: [image] };
		const event = {
			type: "turn_end",
			message: { role: "assistant", content: [] },
			toolResults: [toolResult],
			again: [toolResult, { role: "toolResult", content: [image, image] }],
		};
		const projected = projectImages(event, SESSION) as {
			toolResults: { content: RefImage[] }[];
			again: { content: RefImage[] }[];
		};
		const refs = [
			projected.toolResults[0]?.content[0],
			projected.again[0]?.content[0],
			projected.again[1]?.content[0],
			projected.again[1]?.content[1],
		].map((image) => image?.ref);
		expect(new Set(refs).size).toBe(1);
		expect(projected.again[0]).toBe(projected.toolResults[0]);
	});

	test("hashes the declared type with the bytes, so equal bytes under two types get two URLs", () => {
		const data = png().data;
		const [asPng, asJpeg] = projectImages(
			[
				{ type: "image", data, mimeType: "image/png" },
				{ type: "image", data, mimeType: "image/jpeg" },
			],
			SESSION,
		) as RefImage[];
		expect(asPng?.ref).not.toBe(asJpeg?.ref);
	});

	test("re-hashes a reused block whose data changed", () => {
		const image = png(10, 10, "a");
		const first = refOf(projectImages(image, SESSION)).ref;
		image.data = png(10, 10, "b").data;
		expect(refOf(projectImages(image, SESSION)).ref).not.toBe(first);
	});

	test("leaves an empty-data block alone and omits unknown dimensions", () => {
		const empty = { type: "image", data: "", mimeType: "image/png" };
		expect(projectImages(empty, SESSION)).toBe(empty);
		const unsized = refOf(
			projectImages({ type: "image", data: "AAAA", mimeType: "image/png" }, SESSION),
		);
		expect(unsized.width).toBeUndefined();
		expect(unsized.height).toBeUndefined();
	});

	test("survives a cyclic value", () => {
		const node: Record<string, unknown> = { content: [png()] };
		node.self = node;
		const projected = projectImages(node, SESSION) as { content: RefImage[] };
		expect(projected.content[0]?.ref).toContain(IMAGES_ROUTE);
	});
});

describe("serveImage", () => {
	function pathOf(image: ImageBlock, sessionId = SESSION): string {
		return refOf(projectImages(image, sessionId)).ref;
	}

	test("serves a projected image's bytes with safe headers", async () => {
		const image = png(4, 4);
		const response = serveImage(pathOf(image));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
		const body = Buffer.from(await response.arrayBuffer());
		expect(body.equals(Buffer.from(image.data, "base64"))).toBe(true);
		expect(response.headers.get("Content-Length")).toBe(String(body.byteLength));
	});

	test("ignores the query string a retry adds", () => {
		const path = pathOf(png());
		expect(serveImage(`${path}`).status).toBe(200);
		expect(serveImage(new URL(`http://h${path}?retry=2`).pathname).status).toBe(200);
	});

	test("refuses a type outside the raster allow-list, even when declared as an image", () => {
		const html = {
			type: "image",
			data: Buffer.from("<script>1</script>").toString("base64"),
			mimeType: "text/html",
		};
		const svg = {
			type: "image",
			data: Buffer.from("<svg/>").toString("base64"),
			mimeType: "image/svg+xml",
		};
		for (const block of [html, svg]) {
			const response = serveImage(pathOf(block as ImageBlock));
			expect(response.status).toBe(404);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
	});

	test("rejects malformed paths", () => {
		const hash = "a".repeat(64);
		for (const path of [
			`${IMAGES_ROUTE}${SESSION}`,
			`${IMAGES_ROUTE}${SESSION}/${hash}/extra`,
			`${IMAGES_ROUTE}${SESSION}/not-a-hash`,
			`${IMAGES_ROUTE}..%2F..%2Fetc/${hash}`,
			`${IMAGES_ROUTE}%E0%A4%A/${hash}`,
		]) {
			expect(serveImage(path).status).toBe(404);
		}
	});

	test("a deleted chat stops serving at once, cached or not", () => {
		const path = pathOf(png());
		deleted.add(SESSION);
		expect(serveImage(path).status).toBe(404);
		deleted.delete(SESSION);
		forgetImageSession(SESSION);
		expect(serveImage(path).status).toBe(404);
	});

	test("an evicted image heals from the live source, and only from its own chat", () => {
		resetImages({ cacheLimitChars: png().data.length * 2 });
		setImageSource(source);
		const first = png(1, 1, "first");
		const firstPath = pathOf(first);
		pathOf(png(1, 1, "second"));
		pathOf(png(1, 1, "third"));

		expect(serveImage(firstPath).status).toBe(404);
		blocks.set("another-session", [first]);
		expect(serveImage(firstPath).status).toBe(404);
		blocks.set(SESSION, [first]);
		expect(serveImage(firstPath).status).toBe(200);
	});

	test("an image larger than the cache is never cached but still served from the live source", () => {
		const big = png(1, 1, "x".repeat(64));
		resetImages({ cacheLimitChars: big.data.length - 1 });
		setImageSource(source);
		const path = pathOf(big);
		expect(serveImage(path).status).toBe(404);
		blocks.set(SESSION, [big]);
		expect(serveImage(path).status).toBe(200);
	});

	test("serves nothing without a source", () => {
		const path = pathOf(png());
		setImageSource(null);
		expect(serveImage(path).status).toBe(404);
	});
});
