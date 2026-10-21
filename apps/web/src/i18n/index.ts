/**
 * Public surface of the `i18n` module.
 *
 * Components import copy through here: `import { t } from "@/i18n"`. The `@/i18n/registry` entry is the
 * data-only view for scripts.
 */

export {
	applyLocale,
	DEFAULT_LOCALE,
	getLocale,
	LOCALE_LABELS,
	LOCALES,
	type Locale,
	normalizeLocale,
	resetLocaleCache,
	setLocale,
	storedLocale,
} from "./locale";
export type { Catalog, MessageArgs } from "./translate";
export { formatMessage, t, translate } from "./translate";
