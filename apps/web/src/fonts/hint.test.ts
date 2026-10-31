import { afterEach, beforeEach, expect, test } from "bun:test";
import type { UserFontFileOk } from "@thinkrail/contracts";
import { readFontsHint, writeFontsHint } from "./hint";
import { DEFAULT_FONT_PREFERENCE } from "./runtime";

const store = new Map<string, string>();
const savedStorage = Reflect.get(globalThis, "localStorage");

beforeEach(() => {
	store.clear();
	Reflect.set(globalThis, "localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
	});
});

afterEach(() => {
	Reflect.set(globalThis, "localStorage", savedStorage);
});

function file(fileName: string, family: string): UserFontFileOk {
	return {
		fileName,
		ok: true,
		url: `/fonts/${fileName}?v=1`,
		face: { family, style: "normal", weight: { min: 400, max: 400 }, monospace: true },
	};
}

test("an empty or foreign hint reads as the default preference", () => {
	expect(readFontsHint()).toEqual({ preference: DEFAULT_FONT_PREFERENCE, files: [] });
	store.set("thinkrail-fonts", JSON.stringify({ version: 99, preference: {} }));
	expect(readFontsHint()).toEqual({ preference: DEFAULT_FONT_PREFERENCE, files: [] });
	store.set("thinkrail-fonts", "{");
	expect(readFontsHint()).toEqual({ preference: DEFAULT_FONT_PREFERENCE, files: [] });
});

test("the hint keeps only the custom files the preference names", () => {
	const preference = {
		...DEFAULT_FONT_PREFERENCE,
		codeFont: { family: { name: "Fira Code" }, fallbacks: [{ name: "Meslo" }] },
		codeFontSize: 15,
		terminalFontSize: 20,
	};
	writeFontsHint(preference, [
		file("FiraCode.woff2", "Fira Code"),
		file("Meslo.ttf", "Meslo"),
		file("Inter.ttf", "Inter"),
		{ fileName: "broken.otf", ok: false, error: "invalid-font" },
	]);
	const hint = readFontsHint();
	expect(hint.preference).toEqual(preference);
	expect(hint.files.map((entry) => entry.fileName)).toEqual(["FiraCode.woff2", "Meslo.ttf"]);
});

test("a stored face missing its weight is dropped instead of reaching FontFace at boot", () => {
	const valid = file("FiraCode.woff2", "Fira Code");
	const { weight: _weight, ...face } = valid.ok ? valid.face : { weight: null };
	store.set(
		"thinkrail-fonts",
		JSON.stringify({
			version: 1,
			preference: DEFAULT_FONT_PREFERENCE,
			files: [valid, { ...valid, fileName: "NoWeight.woff2", face }],
		}),
	);
	expect(readFontsHint().files.map((entry) => entry.fileName)).toEqual(["FiraCode.woff2"]);
});

test("v1 migrates once and retains custom faces, v2 missing fields stay modern", () => {
	const face = file("FiraCode.woff2", "Fira Code");
	store.set(
		"thinkrail-fonts",
		JSON.stringify({
			version: 1,
			preference: { codeFontSize: 15, codeFont: { family: { name: "Fira Code" }, fallbacks: [] } },
			files: [face],
		}),
	);
	const migrated = readFontsHint();
	expect(migrated.preference).toMatchObject({ codeFontSize: 13, terminalFontSize: 15 });
	expect(migrated.files).toEqual([face]);
	writeFontsHint(migrated.preference, migrated.files);
	expect(readFontsHint()).toEqual(migrated);
	for (const preference of [{ codeFontSize: 15 }, { codeFontSize: 15, terminalFontSize: "bad" }]) {
		store.set("thinkrail-fonts", JSON.stringify({ version: 2, preference }));
		expect(readFontsHint().preference).toMatchObject({ codeFontSize: 15, terminalFontSize: 13 });
	}
});
