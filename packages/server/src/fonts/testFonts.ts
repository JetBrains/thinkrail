import { brotliCompressSync, deflateSync } from "node:zlib";

export type TestFontFormat = "ttf" | "otf" | "woff" | "woff2";

export interface TestFontOptions {
	family?: string;
	typographicFamily?: string;
	subfamily?: string;
	localizedFamily?: { language: number; name: string };
	macFamily?: Uint8Array;
	weightClass?: number;
	fsSelection?: number;
	italicAngle?: number;
	fixedPitch?: boolean;
	panose?: { familyType: number; proportion: number };
	axes?: { tag: string; min: number; max: number }[];
	withoutOs2?: boolean;
	collectionFlavor?: boolean;
}

interface Table {
	tag: string;
	data: Uint8Array;
	woff2?: { version: number; transformed?: Uint8Array };
}

const WOFF2_KNOWN = new Map([
	["head", 1],
	["hmtx", 3],
	["name", 5],
	["OS/2", 6],
	["post", 7],
	["glyf", 10],
	["loca", 11],
	["fvar", 47],
]);

class Writer {
	private bytes: number[] = [];

	u8(value: number): this {
		this.bytes.push(value & 0xff);
		return this;
	}

	u16(value: number): this {
		return this.u8(value >> 8).u8(value);
	}

	u32(value: number): this {
		return this.u16(Math.floor(value / 0x10000)).u16(value);
	}

	fixed(value: number): this {
		return this.u32((Math.round(value * 65536) + 2 ** 32) % 2 ** 32);
	}

	tag(value: string): this {
		for (const char of value.padEnd(4, " ")) this.u8(char.charCodeAt(0));
		return this;
	}

	raw(data: Uint8Array): this {
		this.bytes.push(...data);
		return this;
	}

	pad(): this {
		while (this.bytes.length % 4) this.u8(0);
		return this;
	}

	get length(): number {
		return this.bytes.length;
	}

	done(): Uint8Array<ArrayBuffer> {
		return Uint8Array.from(this.bytes);
	}
}

function utf16be(text: string): Uint8Array {
	const writer = new Writer();
	for (const char of text) writer.u16(char.charCodeAt(0));
	return writer.done();
}

function nameTable(options: TestFontOptions): Uint8Array {
	const records: {
		platform: number;
		encoding: number;
		language: number;
		id: number;
		text: Uint8Array;
	}[] = [];
	const windows = (id: number, text: string | undefined, language = 0x409) => {
		if (text === undefined) return;
		records.push({ platform: 3, encoding: 1, language, id, text: utf16be(text) });
	};
	if (options.localizedFamily) {
		windows(1, options.localizedFamily.name, options.localizedFamily.language);
	}
	windows(1, options.family ?? (options.macFamily ? undefined : "Test Sans"));
	windows(2, options.subfamily);
	windows(16, options.typographicFamily);
	if (options.macFamily) {
		records.push({ platform: 1, encoding: 0, language: 0, id: 1, text: options.macFamily });
	}
	const writer = new Writer()
		.u16(0)
		.u16(records.length)
		.u16(6 + records.length * 12);
	let offset = 0;
	for (const record of records) {
		writer.u16(record.platform).u16(record.encoding).u16(record.language).u16(record.id);
		writer.u16(record.text.length).u16(offset);
		offset += record.text.length;
	}
	for (const record of records) writer.raw(record.text);
	return writer.done();
}

function os2Table(options: TestFontOptions): Uint8Array {
	const writer = new Writer()
		.u16(4)
		.u16(500)
		.u16(options.weightClass ?? 400);
	while (writer.length < 32) writer.u8(0);
	const panose = options.panose ?? { familyType: 2, proportion: 3 };
	writer.u8(panose.familyType).u8(0).u8(0).u8(panose.proportion);
	while (writer.length < 62) writer.u8(0);
	writer.u16(options.fsSelection ?? 0x40);
	while (writer.length < 96) writer.u8(0);
	return writer.done();
}

function postTable(options: TestFontOptions): Uint8Array {
	return new Writer()
		.u32(0x00030000)
		.fixed(options.italicAngle ?? 0)
		.u16(0)
		.u16(0)
		.u32(options.fixedPitch ? 1 : 0)
		.u32(0)
		.u32(0)
		.u32(0)
		.u32(0)
		.done();
}

function fvarTable(axes: NonNullable<TestFontOptions["axes"]>): Uint8Array {
	const writer = new Writer().u16(1).u16(0).u16(16).u16(2).u16(axes.length).u16(20).u16(0);
	writer.u16(4 + axes.length * 4);
	for (const axis of axes) {
		writer
			.tag(axis.tag)
			.fixed(axis.min)
			.fixed((axis.min + axis.max) / 2)
			.fixed(axis.max);
		writer.u16(0).u16(256);
	}
	return writer.done();
}

function fontTables(options: TestFontOptions): Table[] {
	const tables: Table[] = [
		{ tag: "name", data: nameTable(options) },
		{ tag: "post", data: postTable(options) },
		{ tag: "head", data: new Uint8Array(54).fill(7) },
	];
	if (!options.withoutOs2) tables.push({ tag: "OS/2", data: os2Table(options) });
	if (options.axes) tables.push({ tag: "fvar", data: fvarTable(options.axes) });
	return tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
}

function sfnt(tables: Table[], flavor: string): Uint8Array<ArrayBuffer> {
	const writer = new Writer().tag(flavor).u16(tables.length).u16(0).u16(0).u16(0);
	let offset = 12 + tables.length * 16;
	for (const table of tables) {
		writer.tag(table.tag).u32(0).u32(offset).u32(table.data.length);
		offset += Math.ceil(table.data.length / 4) * 4;
	}
	for (const table of tables) writer.raw(table.data).pad();
	return writer.done();
}

function woff(tables: Table[], flavor: string): Uint8Array<ArrayBuffer> {
	const stored = tables.map((table) => {
		const compressed = deflateSync(table.data);
		return compressed.length < table.data.length ? compressed : table.data;
	});
	const writer = new Writer().tag("wOFF").tag(flavor).u32(0).u16(tables.length).u16(0);
	writer.u32(0).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
	let offset = 44 + tables.length * 20;
	tables.forEach((table, index) => {
		const data = stored[index] ?? table.data;
		writer.tag(table.tag).u32(offset).u32(data.length).u32(table.data.length).u32(0);
		offset += Math.ceil(data.length / 4) * 4;
	});
	for (const data of stored) writer.raw(data).pad();
	return writer.done();
}

function base128(writer: Writer, value: number): void {
	const digits = [value & 0x7f];
	for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
		digits.unshift(rest & 0x7f);
	}
	digits.forEach((digit, index) => {
		writer.u8(index < digits.length - 1 ? digit | 0x80 : digit);
	});
}

function woff2(tables: Table[], flavor: string): Uint8Array<ArrayBuffer> {
	const directory = new Writer();
	const stream: number[] = [];
	for (const table of tables) {
		const known = WOFF2_KNOWN.get(table.tag) ?? 0x3f;
		directory.u8(known | ((table.woff2?.version ?? 0) << 6));
		if (known === 0x3f) directory.tag(table.tag);
		base128(directory, table.data.length);
		const transformed = table.woff2?.transformed;
		if (transformed) base128(directory, transformed.length);
		stream.push(...(transformed ?? table.data));
	}
	const compressed = brotliCompressSync(Uint8Array.from(stream));
	const header = new Writer().tag("wOF2").tag(flavor).u32(0).u16(tables.length).u16(0);
	header.u32(0).u32(compressed.length).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
	return new Writer().raw(header.done()).raw(directory.done()).raw(compressed).pad().done();
}

function withTransformedTables(tables: Table[]): Table[] {
	return [
		{
			tag: "glyf",
			data: new Uint8Array(40),
			woff2: { version: 0, transformed: new Uint8Array(9) },
		},
		{ tag: "loca", data: new Uint8Array(12), woff2: { version: 0, transformed: new Uint8Array() } },
		{
			tag: "hmtx",
			data: new Uint8Array(30),
			woff2: { version: 1, transformed: new Uint8Array(5) },
		},
		{ tag: "Zzzz", data: new Uint8Array(3).fill(1) },
		...tables,
	];
}

export function buildTestFont(
	format: TestFontFormat,
	options: TestFontOptions = {},
): Uint8Array<ArrayBuffer> {
	const tables = fontTables(options);
	const flavor = options.collectionFlavor ? "ttcf" : format === "otf" ? "OTTO" : "\0\x01\0\0";
	if (format === "woff") return woff(tables, flavor);
	if (format === "woff2") return woff2(withTransformedTables(tables), flavor);
	return sfnt(tables, flavor);
}

export function buildTestCollection(): Uint8Array<ArrayBuffer> {
	return new Writer().tag("ttcf").u32(0x00010000).u32(1).u32(16).raw(buildTestFont("ttf")).done();
}
