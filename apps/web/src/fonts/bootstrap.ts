import { readFontsHint } from "./hint";
import { applyFontPreference, installUserFonts } from "./runtime";

export function initializeFonts(): void {
	const hint = readFontsHint();
	installUserFonts(hint.files);
	applyFontPreference(hint.preference);
}
