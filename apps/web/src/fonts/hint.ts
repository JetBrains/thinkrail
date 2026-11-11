import {
	isUserFontFile,
	normalizeFontSettings,
	type UserFontFile,
	type UserFontFileOk,
} from "@thinkrail/contracts";
import { firstPaintPreferenceStorage } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { DEFAULT_FONT_PREFERENCE, type FontPreference } from "./runtime";
import { namedFamilies } from "./stack";

const HINT_KEY = `${STORAGE_PREFIX}fonts`;
const HINT_VERSION = 1;

function isCachedFace(value: unknown): value is UserFontFileOk {
	return isUserFontFile(value) && value.ok;
}

export interface FontsHint {
	preference: FontPreference;
	files: UserFontFileOk[];
}

export function readFontsHint(): FontsHint {
	try {
		const raw = firstPaintPreferenceStorage()?.getItem(HINT_KEY);
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
			files: Array.isArray(files) ? files.filter(isCachedFace) : [],
		};
	} catch {
		return { preference: DEFAULT_FONT_PREFERENCE, files: [] };
	}
}

export function writeFontsHint(preference: FontPreference, files: readonly UserFontFile[]): void {
	const names = namedFamilies([preference.interfaceFont, preference.codeFont]);
	const used = files.filter(
		(file): file is UserFontFileOk => file.ok && names.has(file.face.family),
	);
	try {
		firstPaintPreferenceStorage()?.setItem(
			HINT_KEY,
			JSON.stringify({ version: HINT_VERSION, preference, files: used }),
		);
	} catch {
		return;
	}
}
