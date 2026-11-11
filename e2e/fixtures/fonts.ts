import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const renderers = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../packages/resource-renderers/package.json",
);
const STATIC_SOURCE = join(
	dirname(createRequire(renderers).resolve("pdfjs-dist")),
	"../standard_fonts/LiberationSans-Regular.ttf",
);

function paddedLength(length: number): number {
	return Math.ceil(length / 4) * 4;
}

function checksum(bytes: Uint8Array): number {
	const padded = new Uint8Array(paddedLength(bytes.length));
	padded.set(bytes);
	const view = new DataView(padded.buffer);
	let sum = 0;
	for (let at = 0; at < padded.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0;
	return sum;
}

function nameTable(family: string): Uint8Array {
	const records: [number, string][] = [
		[1, family],
		[2, "Regular"],
		[4, family],
		[6, family.replaceAll(" ", "")],
	];
	const strings = records.map(([, text]) => Buffer.from(text, "utf16le").swap16());
	const header = 6 + records.length * 12;
	const bytes = new Uint8Array(header + strings.reduce((sum, text) => sum + text.length, 0));
	const view = new DataView(bytes.buffer);
	view.setUint16(2, records.length);
	view.setUint16(4, header);
	let offset = 0;
	records.forEach(([id], index) => {
		const text = strings[index] ?? Buffer.alloc(0);
		const at = 6 + index * 12;
		view.setUint16(at, 3);
		view.setUint16(at + 2, 1);
		view.setUint16(at + 4, 0x409);
		view.setUint16(at + 6, id);
		view.setUint16(at + 8, text.length);
		view.setUint16(at + 10, offset);
		bytes.set(text, header + offset);
		offset += text.length;
	});
	return bytes;
}

/** A real static TrueType face (one weight, Latin glyphs) under a family no machine has installed. */
export function fixtureFont(family: string): Buffer {
	const source = new Uint8Array(readFileSync(STATIC_SOURCE));
	const view = new DataView(source.buffer);
	const count = view.getUint16(4);
	const tables = Array.from({ length: count }, (_, index) => {
		const at = 12 + index * 16;
		const tag = String.fromCharCode(...source.subarray(at, at + 4));
		const start = view.getUint32(at + 8);
		const data =
			tag === "name" ? nameTable(family) : source.slice(start, start + view.getUint32(at + 12));
		if (tag === "head") new DataView(data.buffer).setUint32(8, 0);
		return { tag, data };
	});
	let offset = 12 + count * 16;
	const font = new Uint8Array(
		tables.reduce((total, table) => total + paddedLength(table.data.length), offset),
	);
	const out = new DataView(font.buffer);
	font.set(source.subarray(0, 12));
	let headAt = -1;
	tables.forEach((table, index) => {
		const at = 12 + index * 16;
		font.set(new TextEncoder().encode(table.tag), at);
		out.setUint32(at + 4, checksum(table.data));
		out.setUint32(at + 8, offset);
		out.setUint32(at + 12, table.data.length);
		font.set(table.data, offset);
		if (table.tag === "head") headAt = offset;
		offset += paddedLength(table.data.length);
	});
	if (headAt >= 0) out.setUint32(headAt + 8, (0xb1b0afba - checksum(font)) >>> 0);
	return Buffer.from(font);
}
