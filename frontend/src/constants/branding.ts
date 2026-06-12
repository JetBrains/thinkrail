/** Product name — single source of truth for human-facing text. Change it
 *  here to rebrand everywhere. */
export const PRODUCT_NAME = "ThinkRail";

/** Lowercase technical slug for namespacing persisted keys, MIME types, and
 *  DOM events. Kept separate from PRODUCT_NAME so renaming the display name
 *  never changes persisted localStorage keys or in-flight event/MIME strings. */
export const APP_SLUG = "thinkrail";

/** Prefix for persisted localStorage keys (e.g. `thinkrail-ui`). */
export const STORAGE_PREFIX = `${APP_SLUG}-`;

/** MIME type for internal drag-and-drop file payloads. */
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;

/** Prefix for app-internal DOM CustomEvents (e.g. `thinkrail:expandAll`). */
export const EVENT_PREFIX = `${APP_SLUG}:`;
