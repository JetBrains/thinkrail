import { brotliDecompressSync, inflateSync } from "node:zlib";
import { isFontFamilyName, type UserFontFace } from "@thinkrail/contracts";

export type FontFormatErrorCode = "invalid-font" | "unsupported-collection";

export class FontFormatError extends Error {
	readonly code: FontFormatErrorCode;

	constructor(code: FontFormatErrorCode, message: string) {
		super(message);
		this.name = "FontFormatError";
		this.code = code;
	}
}

const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const SFNT_VERSIONS = new Set(["\0\x01\0\0", "true", "OTTO"]);
const WANTED_TABLES = new Set(["name", "OS/2", "post", "fvar"]);
const WOFF2_KNOWN_TAGS =
	"cmapheadhheahmtxmaxpnameOS/2postcvt fpgmglyflocaprepCFF VORGEBDTEBLCgasphdmxkernLTSHPCLTVDMXvhea" +
	"vmtxBASEGDEFGPOSGSUBEBSCJSTFMATHCBDTCBLCCOLRCPALSVG sbixacntavarbdatblocbslncvarfdscfeatfmtxfvar" +
	"gvarhstyjustlcarmortmorxopbdproptrakZapfSilfGlatGlocFeatSill";
const WOFF2_ARBITRARY_TAG = 0x3f;
const FAMILY_NAME_IDS = [16, 1];
const SUBFAMILY_NAME_IDS = [17, 2];
const FS_SELECTION_ITALIC_OR_OBLIQUE = 0x0201;
const PANOSE_LATIN_TEXT = 2;
const PANOSE_MONOSPACED = 9;

function invalid(message: string): never {
	throw new FontFormatError("invalid-font", message);
}

function collection(): never {
	throw new FontFormatError("unsupported-collection", "the file is a font collection");
}

class Bytes {
	readonly data: Uint8Array;
	readonly label: string;
	private readonly view: DataView;

	constructor(data: Uint8Array, label: string) {
		this.data = data;
		this.label = label;
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}

	private at(offset: number, size: number): number {
		if (offset < 0 || offset + size > this.data.byteLength) invalid(`${this.label} is truncated`);
		return offset;
	}

	u8(offset: number): number {
		return this.view.getUint8(this.at(offset, 1));
	}

	u16(offset: number): number {
		return this.view.getUint16(this.at(offset, 2));
	}

	u32(offset: number): number {
		return this.view.getUint32(this.at(offset, 4));
	}

	fixed(offset: number): number {
		return this.view.getInt32(this.at(offset, 4)) / 65536;
	}

	tag(offset: number): string {
		return String.fromCharCode(...this.slice(offset, 4));
	}

	slice(offset: number, length: number): Uint8Array {
		this.at(offset, length);
		return this.data.subarray(offset, offset + length);
	}

	table(offset: number, length: number, tag: string): Bytes {
		return new Bytes(this.slice(offset, length), `the ${tag} table`);
	}
}

type Tables = Map<string, Bytes>;

function expanded(what: string, decompress: () => Uint8Array): Uint8Array {
	try {
		return decompress();
	} catch {
		return invalid(`${what} does not decompress`);
	}
}

function sfntTables(file: Bytes): Tables {
	const tables: Tables = new Map();
	for (let index = 0, count = file.u16(4); index < count; index++) {
		const record = 12 + index * 16;
		const tag = file.tag(record);
		if (!WANTED_TABLES.has(tag) || tables.has(tag)) continue;
		tables.set(tag, file.table(file.u32(record + 8), file.u32(record + 12), tag));
	}
	return tables;
}

function woffTables(file: Bytes): Tables {
	if (file.tag(4) === "ttcf") collection();
	const tables: Tables = new Map();
	for (let index = 0, count = file.u16(12); index < count; index++) {
		const entry = 44 + index * 20;
		const tag = file.tag(entry);
		if (!WANTED_TABLES.has(tag) || tables.has(tag)) continue;
		const stored = file.slice(file.u32(entry + 4), file.u32(entry + 8));
		const length = file.u32(entry + 12);
		if (stored.byteLength > length || length > MAX_EXPANDED_BYTES) {
			invalid(`the WOFF ${tag} table has inconsistent lengths`);
		}
		const data =
			stored.byteLength === length
				? stored
				: expanded(`the WOFF ${tag} table`, () => inflateSync(stored, { maxOutputLength: length }));
		if (data.byteLength !== length) invalid(`the WOFF ${tag} table has inconsistent lengths`);
		tables.set(tag, new Bytes(data, `the ${tag} table`));
	}
	return tables;
}

function base128(file: Bytes, offset: number): [value: number, next: number] {
	let value = 0;
	for (let index = 0; index < 5; index++) {
		const byte = file.u8(offset + index);
		if (index === 0 && byte === 0x80) invalid("a WOFF2 length has leading zeros");
		if (value >= 2 ** 25) invalid("a WOFF2 length overflows");
		value = value * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) return [value, offset + index + 1];
	}
	return invalid("a WOFF2 length is longer than five bytes");
}

function woff2Tables(file: Bytes): Tables {
	if (file.tag(4) === "ttcf") collection();
	const wanted: { tag: string; offset: number; length: number }[] = [];
	let cursor = 48;
	let streamLength = 0;
	for (let index = 0, count = file.u16(12); index < count; index++) {
		const flags = file.u8(cursor);
		const known = flags & 0x3f;
		const tag =
			known === WOFF2_ARBITRARY_TAG
				? file.tag(cursor + 1)
				: WOFF2_KNOWN_TAGS.slice(known * 4, known * 4 + 4);
		cursor += known === WOFF2_ARBITRARY_TAG ? 5 : 1;
		const version = flags >> 6;
		const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
		let length: number;
		[length, cursor] = base128(file, cursor);
		if (transformed) [length, cursor] = base128(file, cursor);
		if (WANTED_TABLES.has(tag)) {
			if (transformed) invalid(`the WOFF2 ${tag} table uses an unknown transform`);
			wanted.push({ tag, offset: streamLength, length });
		}
		streamLength += length;
	}
	if (streamLength > MAX_EXPANDED_BYTES) invalid("the WOFF2 font data is too large");
	const compressed = file.slice(cursor, file.u32(20));
	const stream = new Bytes(
		expanded("the WOFF2 font data", () =>
			brotliDecompressSync(compressed, { maxOutputLength: Math.max(streamLength, 1) }),
		),
		"the WOFF2 font data",
	);
	const tables: Tables = new Map();
	for (const { tag, offset, length } of wanted) {
		if (!tables.has(tag)) tables.set(tag, stream.table(offset, length, tag));
	}
	return tables;
}

interface NameRecord {
	platform: number;
	encoding: number;
	language: number;
	id: number;
	length: number;
	offset: number;
}

function nameRecords(name: Bytes): NameRecord[] {
	const storage = name.u16(4);
	return Array.from({ length: name.u16(2) }, (_, index) => {
		const record = 6 + index * 12;
		return {
			platform: name.u16(record),
			encoding: name.u16(record + 2),
			language: name.u16(record + 4),
			id: name.u16(record + 6),
			length: name.u16(record + 8),
			offset: storage + name.u16(record + 10),
		};
	});
}

function nameRank({ platform, encoding, language }: NameRecord): number {
	if (platform === 3 && (encoding === 0 || encoding === 1 || encoding === 10)) {
		return language === 0x409 ? 0 : 1;
	}
	if (platform === 0) return 2;
	if (platform === 1 && encoding === 0) return language === 0 ? 3 : 4;
	return Number.POSITIVE_INFINITY;
}

function printable(text: string): string {
	return [...text]
		.filter((char) => {
			const code = char.codePointAt(0) ?? 0;
			return code >= 0x20 && code !== 0x7f;
		})
		.join("")
		.trim();
}

function bestName(name: Bytes, records: NameRecord[], ids: number[]): string {
	for (const id of ids) {
		const candidates = records
			.filter((record) => record.id === id && nameRank(record) !== Number.POSITIVE_INFINITY)
			.sort((a, b) => nameRank(a) - nameRank(b));
		for (const record of candidates) {
			const decoder = new TextDecoder(record.platform === 1 ? "macintosh" : "utf-16be");
			const text = printable(decoder.decode(name.slice(record.offset, record.length)));
			if (text) return text;
		}
	}
	return "";
}

function cssWeight(value: number): number {
	return Math.min(1000, Math.max(1, Math.round(value)));
}

function weightAxis(fvar: Bytes): UserFontFace["weight"] | null {
	const axes = fvar.u16(4);
	const size = fvar.u16(10);
	for (let index = 0, count = fvar.u16(8); index < count; index++) {
		if (size < 20) invalid("the fvar table has short axis records");
		const axis = axes + index * size;
		if (fvar.tag(axis) !== "wght") continue;
		const min = cssWeight(fvar.fixed(axis + 4));
		const max = cssWeight(fvar.fixed(axis + 12));
		return { min: Math.min(min, max), max: Math.max(min, max) };
	}
	return null;
}

function faceOf(tables: Tables): UserFontFace {
	const name = tables.get("name") ?? invalid("the font has no name table");
	const records = nameRecords(name);
	const family = bestName(name, records, FAMILY_NAME_IDS);
	if (!family) invalid("the font names no family");
	if (!isFontFamilyName(family)) invalid(`the family name "${family}" cannot be used`);
	const subfamily = bestName(name, records, SUBFAMILY_NAME_IDS);
	const os2 = tables.get("OS/2");
	const post = tables.get("post");
	const fvar = tables.get("fvar");
	const italic =
		((os2?.u16(62) ?? 0) & FS_SELECTION_ITALIC_OR_OBLIQUE) !== 0 ||
		(post?.fixed(4) ?? 0) !== 0 ||
		/italic|oblique/i.test(subfamily);
	const monospace =
		(post?.u32(12) ?? 0) !== 0 ||
		(os2 !== undefined && os2.u8(32) === PANOSE_LATIN_TEXT && os2.u8(35) === PANOSE_MONOSPACED);
	const weightClass = os2?.u16(4) ?? 400;
	const weight = weightClass >= 1 && weightClass <= 1000 ? weightClass : 400;
	return {
		family,
		style: italic ? "italic" : "normal",
		weight: (fvar && weightAxis(fvar)) ?? { min: weight, max: weight },
		monospace,
	};
}

export function readFontFace(bytes: Uint8Array): UserFontFace {
	const file = new Bytes(bytes, "the font file");
	const signature = file.tag(0);
	if (signature === "ttcf") collection();
	if (signature === "wOFF") return faceOf(woffTables(file));
	if (signature === "wOF2") return faceOf(woff2Tables(file));
	if (SFNT_VERSIONS.has(signature)) return faceOf(sfntTables(file));
	return invalid("the file is not a TrueType, OpenType, WOFF or WOFF2 font");
}
