import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { ResourceMeta } from "@thinkrail/contracts";

export const CONTENT_SNIFF_BYTES = 8 * 1024;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const UTF8 = new TextDecoder("utf-8", { ignoreBOM: true });

const MAGIC: ReadonlyArray<{ mime: string; bytes: readonly number[] }> = [
	{ mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
	{ mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
	{ mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
	{ mime: "image/bmp", bytes: [0x42, 0x4d] },
	{ mime: "image/x-icon", bytes: [0x00, 0x00, 0x01, 0x00] },
	{ mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
	{ mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
	{ mime: "application/zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
	{ mime: "application/zip", bytes: [0x50, 0x4b, 0x07, 0x08] },
	{ mime: "application/gzip", bytes: [0x1f, 0x8b] },
	{ mime: "font/woff", bytes: [0x77, 0x4f, 0x46, 0x46] },
	{ mime: "font/woff2", bytes: [0x77, 0x4f, 0x46, 0x32] },
];

const EXTENSION_MIME: Readonly<Record<string, string>> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".json": "application/json",
	".csv": "text/csv",
	".tsv": "text/csv",
	".yaml": "text/yaml",
	".yml": "text/yaml",
	".html": "text/html",
	".htm": "text/html",
	".xhtml": "application/xhtml+xml",
	".txt": "text/plain",
};

const SVG_ROOT = /^\s*<svg[\s>]/;
const XML_PROLOG = /^\s*<\?xml(?:\s|\?>)/;
const LFS_POINTER_LIMIT = 1024;
const LFS_POINTER =
	/^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d{1,15}\n$/;

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
	if (bytes.length < offset + magic.length) return false;
	return magic.every((byte, index) => bytes[offset + index] === byte);
}

const FTYP = [0x66, 0x74, 0x79, 0x70];
const AVIF_BRANDS = [
	[0x61, 0x76, 0x69, 0x66],
	[0x61, 0x76, 0x69, 0x73],
];

function sniffMagic(bytes: Uint8Array): string | undefined {
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return "image/webp";
	}
	if (startsWith(bytes, FTYP, 4) && AVIF_BRANDS.some((brand) => startsWith(bytes, brand, 8))) {
		return "image/avif";
	}
	return MAGIC.find(({ bytes: magic }) => startsWith(bytes, magic))?.mime;
}

function isTextBytes(bytes: Uint8Array): boolean {
	if (bytes.subarray(0, CONTENT_SNIFF_BYTES).includes(0)) return false;
	try {
		STRICT_UTF8.decode(bytes);
		return true;
	} catch {
		return false;
	}
}

function isSvg(bytes: Uint8Array): boolean {
	const head = UTF8.decode(bytes.subarray(0, CONTENT_SNIFF_BYTES));
	if (SVG_ROOT.test(head)) return true;
	if (!XML_PROLOG.test(head)) return false;
	const prologEnd = head.indexOf("?>");
	return prologEnd !== -1 && /<svg[\s>]/.test(head.slice(prologEnd + 2));
}

function isLfsPointer(bytes: Uint8Array): boolean {
	return bytes.byteLength <= LFS_POINTER_LIMIT && LFS_POINTER.test(UTF8.decode(bytes));
}

export function classifyBytes(bytes: Uint8Array): { text: boolean; mime?: string } {
	const magic = sniffMagic(bytes);
	if (magic !== undefined) return { text: false, mime: magic };
	const text = isTextBytes(bytes);
	if (!text) return { text };
	if (isSvg(bytes)) return { text, mime: "image/svg+xml" };
	if (isLfsPointer(bytes)) return { text, mime: "application/vnd.git-lfs" };
	return { text };
}

export function hashBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function decodeText(bytes: Uint8Array): string {
	return UTF8.decode(bytes);
}

export function mimeFromPath(path: string): string | undefined {
	return EXTENSION_MIME[extname(path).toLowerCase()];
}

export function resourceMeta(bytes: Uint8Array | null, path: string): ResourceMeta {
	if (bytes === null) return { hash: null, byteLength: null, text: true };
	const { text, mime } = classifyBytes(bytes);
	const resolved = mime ?? mimeFromPath(path);
	return {
		hash: hashBytes(bytes),
		byteLength: bytes.byteLength,
		text,
		...(resolved === undefined ? {} : { mime: resolved }),
	};
}
