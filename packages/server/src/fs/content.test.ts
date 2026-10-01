import { expect, test } from "bun:test";
import { classifyBytes, decodeText, hashBytes, resourceMeta } from "./content";

const BYTES = new TextEncoder();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

test("a NUL byte or invalid UTF-8 is bytes; UTF-8 (BOM allowed) and emptiness are text", () => {
	expect(classifyBytes(BYTES.encode("const a = 1;\n")).text).toBe(true);
	const bom = BYTES.encode("\ufeffconst a = 1;\n");
	expect(classifyBytes(bom).text).toBe(true);
	expect(decodeText(bom)).toBe("\ufeffconst a = 1;\n");
	expect(classifyBytes(new Uint8Array([])).text).toBe(true);
	expect(classifyBytes(new Uint8Array([0x61, 0x00, 0x62])).text).toBe(false);
	expect(classifyBytes(new Uint8Array([0xff, 0xfe, 0x41])).text).toBe(false);
	const lateNul = new Uint8Array(8 * 1024 + 1).fill(0x61);
	lateNul[lateNul.length - 1] = 0;
	expect(classifyBytes(lateNul).text).toBe(true);
});

test("magic bytes name the media type before any filename is consulted", () => {
	expect(classifyBytes(PNG)).toEqual({ text: false, mime: "image/png" });
	expect(classifyBytes(BYTES.encode("%PDF-1.7\n"))).toEqual({
		text: false,
		mime: "application/pdf",
	});
	expect(classifyBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({
		text: false,
		mime: "image/jpeg",
	});
	expect(classifyBytes(BYTES.encode("GIF89a\u0000"))).toEqual({ text: false, mime: "image/gif" });
	expect(classifyBytes(BYTES.encode("RIFF\u0000\u0000\u0000\u0000WEBP\u0000"))).toEqual({
		text: false,
		mime: "image/webp",
	});
	expect(
		classifyBytes(BYTES.encode("NOPE\u0000\u0000\u0000\u0000WEBP\u0000")).mime,
	).toBeUndefined();
	expect(classifyBytes(new Uint8Array([0x1f, 0x8b, 0x08, 0x00])).mime).toBe("application/gzip");
	expect(classifyBytes(BYTES.encode("wOFF\u0000\u0000")).mime).toBe("font/woff");
	expect(classifyBytes(BYTES.encode("wOF2\u0000\u0000")).mime).toBe("font/woff2");
	expect(classifyBytes(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01])).mime).toBe("image/x-icon");
	expect(classifyBytes(new Uint8Array([0x42, 0x4d, 0x00, 0x01])).mime).toBe("image/bmp");
	expect(classifyBytes(BYTES.encode("PK\u0003\u0004\u0000")).mime).toBe("application/zip");
	expect(classifyBytes(BYTES.encode("PK\u0005\u0006\u0000")).mime).toBe("application/zip");
});

test("svg is sniffed as text with an image type, directly or behind an XML prolog", () => {
	expect(classifyBytes(BYTES.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
		text: true,
		mime: "image/svg+xml",
	});
	expect(classifyBytes(BYTES.encode('<?xml version="1.0"?>\n<svg></svg>\n')).mime).toBe(
		"image/svg+xml",
	);
	expect(classifyBytes(BYTES.encode('<?xml version="1.0"?>\n<plan><step/></plan>\n')).mime).toBe(
		undefined,
	);
});

test("the extension map is the fallback when bytes prove no media type", () => {
	expect(resourceMeta(BYTES.encode("# Title\n"), "docs/a.md").mime).toBe("text/markdown");
	expect(resourceMeta(BYTES.encode("{}"), "a.json").mime).toBe("application/json");
	expect(resourceMeta(BYTES.encode("a,b\n"), "data/rows.CSV").mime).toBe("text/csv");
	expect(resourceMeta(BYTES.encode("a: 1\n"), "config.yml").mime).toBe("text/yaml");
	expect(resourceMeta(BYTES.encode("<p>hi</p>"), "page.html").mime).toBe("text/html");
	expect(resourceMeta(BYTES.encode("<html/>"), "page.xhtml").mime).toBe("application/xhtml+xml");
	expect(resourceMeta(BYTES.encode("hi"), "notes.txt").mime).toBe("text/plain");
	expect(resourceMeta(BYTES.encode("export const a = 1;\n"), "a.ts").mime).toBe(undefined);
	expect(resourceMeta(new Uint8Array([0xff]), "mislabelled.md").mime).toBe("text/markdown");
	expect(resourceMeta(PNG, "mislabelled.md").mime).toBe("image/png");
});

test("resource metadata carries byte identity, and absence carries none", () => {
	expect(resourceMeta(BYTES.encode("abc"), "a.bin")).toEqual({
		hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		byteLength: 3,
		text: true,
	});
	expect(hashBytes(BYTES.encode("abc"))).toBe(
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	);
	expect(resourceMeta(null, "gone.png")).toEqual({ hash: null, byteLength: null, text: true });
});
