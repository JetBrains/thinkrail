/**
 * English catalog: intentionally empty.
 *
 * The English key *is* the copy, so nothing needs translating into it — omitting a key here is what
 * makes `translate("…")` return its own source string. Keeping the file makes the locale set uniform
 * and gives future English-only overrides one obvious home.
 */
import type { Catalog } from "../translate";

export const en: Catalog = {};
