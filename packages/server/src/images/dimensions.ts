export interface Dimensions {
	width: number;
	height: number;
}

function pngDimensions(b: Buffer): Dimensions | undefined {
	if (b.length < 24) return undefined;
	if (b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return undefined;
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegDimensions(b: Buffer): Dimensions | undefined {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
	let off = 2;
	while (off + 9 <= b.length) {
		if (b[off] !== 0xff) return undefined;
		const marker = b[off + 1] ?? 0;
		if (marker === 0xff) {
			off++;
			continue;
		}
		const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
		if (isSof) return { width: b.readUInt16BE(off + 7), height: b.readUInt16BE(off + 5) };
		if (marker === 0xd9 || marker === 0xda) return undefined;
		off += 2 + b.readUInt16BE(off + 2);
	}
	return undefined;
}

function gifDimensions(b: Buffer): Dimensions | undefined {
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
		return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
	}
	if (chunk === "VP8 ") {
		if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
		return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === "VP8L") {
		if (b[20] !== 0x2f) return undefined;
		const bits = b.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	return undefined;
}

const MAX_SNIFF_BYTES = 256 * 1024;
const MAX_SNIFF_BASE64_CHARS = Math.ceil(MAX_SNIFF_BYTES / 3) * 4;

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
		return undefined;
	}
}
