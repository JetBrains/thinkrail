import {
	isFontFamilyName,
	normalizeFontSettings,
	type UserFontFile,
	type UserFontFileOk,
} from "@thinkrail/contracts";
import {
	asStablePreferenceAdapter,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { DEFAULT_FONT_PREFERENCE, type FontPreference } from "./runtime";

const HINT_KEY = `${STORAGE_PREFIX}fonts`;
const HINT_VERSION = 1;

export interface FontsHint {
	preference: FontPreference;
	files: UserFontFileOk[];
}

function storage(): StablePreferenceAdapter | null {
	return (
		getStablePreferenceAdapter() ??
		asStablePreferenceAdapter(Reflect.get(globalThis, "localStorage"))
	);
}

function namedFamilies(preference: FontPreference): Set<string> {
	const names = new Set<string>();
	for (const choice of [preference.interfaceFont, preference.codeFont]) {
		for (const ref of [choice.family, ...choice.fallbacks]) {
			if (ref && "name" in ref) names.add(ref.name);
		}
	}
	return names;
}

function isWeightRange(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const min = Reflect.get(value, "min");
	const max = Reflect.get(value, "max");
	return typeof min === "number" && typeof max === "number" && min <= max;
}

function isHintFile(value: unknown): value is UserFontFileOk {
	if (typeof value !== "object" || value === null) return false;
	const face = Reflect.get(value, "face");
	return (
		Reflect.get(value, "ok") === true &&
		typeof Reflect.get(value, "url") === "string" &&
		typeof Reflect.get(value, "fileName") === "string" &&
		typeof face === "object" &&
		face !== null &&
		isFontFamilyName(Reflect.get(face, "family")) &&
		(Reflect.get(face, "style") === "normal" || Reflect.get(face, "style") === "italic") &&
		isWeightRange(Reflect.get(face, "weight")) &&
		typeof Reflect.get(face, "monospace") === "boolean"
	);
}

export function readFontsHint(): FontsHint {
	try {
		const raw = storage()?.getItem(HINT_KEY);
		if (typeof raw !== "string") return { preference: DEFAULT_FONT_PREFERENCE, files: [] };
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Reflect.get(parsed, "version") !== HINT_VERSION
		) {
			return { preference: DEFAULT_FONT_PREFERENCE, files: [] };
		}
		const files = Reflect.get(parsed, "files");
		return {
			preference: normalizeFontSettings(Reflect.get(parsed, "preference")),
			files: Array.isArray(files) ? files.filter(isHintFile) : [],
		};
	} catch {
		return { preference: DEFAULT_FONT_PREFERENCE, files: [] };
	}
}

export function writeFontsHint(preference: FontPreference, files: readonly UserFontFile[]): void {
	const names = namedFamilies(preference);
	const used = files.filter(
		(file): file is UserFontFileOk => file.ok && names.has(file.face.family),
	);
	try {
		storage()?.setItem(
			HINT_KEY,
			JSON.stringify({ version: HINT_VERSION, preference, files: used }),
		);
	} catch {
		return;
	}
}
