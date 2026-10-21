/**
 * The i18n registry barrel — catalog data and lookup in one import for tooling.
 *
 * Split from the module `index.ts` only so build-time scripts can read the registry without pulling
 * the browser-only locale detection in `locale.ts` (which touches `navigator`/`location`).
 */
export { en } from "./catalogs/en";
export { zhCN } from "./catalogs/zh-CN";
export { MESSAGE_KEYS, type MessageKey } from "./keys";
export type { Catalog, MessageArgs } from "./translate";
export { CATALOGS, formatMessage, t, translate, untranslatedKeys } from "./translate";
