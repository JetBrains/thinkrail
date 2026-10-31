import { describe, expect, test } from "bun:test";
import { FontFormatError, readFontFace } from "./sfnt";
import { buildTestCollection, buildTestFont, type TestFontFormat } from "./testFonts";

const FORMATS: TestFontFormat[] = ["ttf", "otf", "woff", "woff2"];

function failure(bytes: Uint8Array): FontFormatError {
	try {
		readFontFace(bytes);
	} catch (error) {
		if (error instanceof FontFormatError) return error;
		throw error;
	}
	throw new Error("the font parsed");
}

describe.each(FORMATS)("%s", (format) => {
	test("reads the typographic family, weight and style", () => {
		const face = readFontFace(
			buildTestFont(format, {
				family: "Inter Light",
				typographicFamily: "Inter",
				subfamily: "Light",
				weightClass: 300,
			}),
		);
		expect(face).toEqual({
			family: "Inter",
			style: "normal",
			weight: { min: 300, max: 300 },
			monospace: false,
		});
	});

	test("a variable font reports its wght axis range", () => {
		const face = readFontFace(
			buildTestFont(format, {
				weightClass: 400,
				axes: [
					{ tag: "wdth", min: 75, max: 100 },
					{ tag: "wght", min: 100, max: 900 },
				],
			}),
		);
		expect(face.weight).toEqual({ min: 100, max: 900 });
	});

	test("italic and monospace come from the OS/2 and post tables", () => {
		expect(readFontFace(buildTestFont(format, { fsSelection: 0x01 })).style).toBe("italic");
		expect(readFontFace(buildTestFont(format, { fixedPitch: true })).monospace).toBe(true);
	});

	test("a collection flavor is reported as an unsupported collection", () => {
		if (format === "ttf" || format === "otf") return;
		expect(failure(buildTestFont(format, { collectionFlavor: true })).code).toBe(
			"unsupported-collection",
		);
	});

	test("every truncation either still reads the same face or is an invalid font", () => {
		const font = buildTestFont(format, { typographicFamily: "Cut", fixedPitch: true });
		const face = readFontFace(font);
		let rejected = 0;
		for (let length = 0; length < font.length; length++) {
			try {
				expect(readFontFace(font.subarray(0, length))).toEqual(face);
			} catch (error) {
				expect(error).toBeInstanceOf(FontFormatError);
				expect((error as FontFormatError).code).toBe("invalid-font");
				rejected++;
			}
		}
		expect(rejected).toBeGreaterThan(font.length / 2);
	});
});

test("family falls back to name ID 1, preferring Windows English, then any Windows, then Mac", () => {
	expect(readFontFace(buildTestFont("ttf", { family: "Plain" })).family).toBe("Plain");
	expect(
		readFontFace(
			buildTestFont("ttf", {
				family: "English",
				localizedFamily: { language: 0x407, name: "Deutsch" },
				macFamily: Uint8Array.from(Buffer.from("Mac")),
			}),
		).family,
	).toBe("English");
	expect(
		readFontFace(
			buildTestFont("ttf", {
				localizedFamily: { language: 0x407, name: "Deutsch" },
				macFamily: Uint8Array.from(Buffer.from("Mac")),
			}),
		).family,
	).toBe("Deutsch");
	expect(
		readFontFace(buildTestFont("ttf", { macFamily: Uint8Array.from([0x43, 0x61, 0x66, 0x8e]) }))
			.family,
	).toBe("Café");
});

test("italic also follows the post italic angle and an Italic/Oblique subfamily", () => {
	expect(readFontFace(buildTestFont("ttf", { italicAngle: -12 })).style).toBe("italic");
	expect(readFontFace(buildTestFont("ttf", { subfamily: "Bold Oblique" })).style).toBe("italic");
	expect(readFontFace(buildTestFont("ttf", { subfamily: "Bold" })).style).toBe("normal");
});

test("PANOSE marks a Latin text face monospaced only with proportion 9", () => {
	const panose = (familyType: number, proportion: number) =>
		readFontFace(buildTestFont("ttf", { panose: { familyType, proportion } })).monospace;
	expect(panose(2, 9)).toBe(true);
	expect(panose(2, 3)).toBe(false);
	expect(panose(3, 9)).toBe(false);
});

test("without an OS/2 table the weight is 400; an out-of-range weight class reads as 400", () => {
	expect(readFontFace(buildTestFont("ttf", { withoutOs2: true })).weight).toEqual({
		min: 400,
		max: 400,
	});
	expect(readFontFace(buildTestFont("ttf", { weightClass: 0 })).weight).toEqual({
		min: 400,
		max: 400,
	});
});

test("a collection header is an unsupported collection, not an invalid font", () => {
	const error = failure(buildTestCollection());
	expect(error.code).toBe("unsupported-collection");
});

test("garbage, a missing name table and an unusable family name are invalid fonts", () => {
	expect(failure(new TextEncoder().encode("hello, world")).message).toContain("not a TrueType");
	expect(failure(new Uint8Array()).code).toBe("invalid-font");
	expect(failure(buildTestFont("ttf", { family: 'Bad"Name' })).message).toContain("cannot be used");
	expect(failure(buildTestFont("ttf", { family: "" })).message).toContain("names no family");
	const font = buildTestFont("ttf");
	const renamed = font.slice();
	const text = Buffer.from(renamed.buffer).toString("latin1");
	renamed.set(Buffer.from("nope", "latin1"), text.indexOf("name"));
	expect(failure(renamed).message).toContain("no name table");
});

test("corrupt compressed data is an invalid font", () => {
	const woff2 = buildTestFont("woff2");
	const corrupt = woff2.slice();
	corrupt.fill(0xff, corrupt.length - 24);
	expect(failure(corrupt).code).toBe("invalid-font");
	const leadingZero = woff2.slice();
	leadingZero[49] = 0x80;
	expect(failure(leadingZero).code).toBe("invalid-font");
});
