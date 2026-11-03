import { codeToHtml, isSupportedLanguage } from "@pierre/highlights";
import { THINKRAIL_PIERRE_THEME } from "@/themes";

const decoder = new TextDecoder();

export function renderChatHighlight(code: string, lang: string) {
	if (!isSupportedLanguage(lang)) return null;
	try {
		return decoder
			.decode(codeToHtml(code, { lang, theme: THINKRAIL_PIERRE_THEME }))
			.replace('class="highlights"', 'tabindex="0" class="highlights"');
	} catch {
		return null;
	}
}
