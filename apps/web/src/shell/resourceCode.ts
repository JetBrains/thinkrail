import type { ResourceCodeHost } from "@thinkrail/resource-renderers";
import { cssColorToHex } from "../lib";
import { SHIKI_FILE_LANGUAGES, shikiLanguageId } from "../lib/highlighter";
import { resolveThinkrailShikiTheme } from "../themes";

export const resourceCode: ResourceCodeHost = {
	languages: SHIKI_FILE_LANGUAGES,
	languageId: shikiLanguageId,
	theme: (options) => resolveThinkrailShikiTheme({ ...options, toHex: cssColorToHex }),
};
