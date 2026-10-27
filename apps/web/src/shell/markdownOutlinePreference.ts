import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { getTransport } from "../transport";

export const MARKDOWN_OUTLINE_VISIBLE_KEY = "markdown-outline-visible";

export function markdownOutlineStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}${MARKDOWN_OUTLINE_VISIBLE_KEY}:${httpBase}`;
}

export function parseMarkdownOutlineVisible(value: string | null): boolean | null {
	if (value === "true") return true;
	if (value === "false") return false;
	return null;
}

function browserStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function readMarkdownOutlineVisible(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): boolean | null {
	if (stablePreferences) {
		try {
			return parseMarkdownOutlineVisible(stablePreferences.getItem(MARKDOWN_OUTLINE_VISIBLE_KEY));
		} catch {
			return null;
		}
	}
	try {
		return parseMarkdownOutlineVisible(
			browserStorage()?.getItem(markdownOutlineStorageKey(getTransport().httpBase())) ?? null,
		);
	} catch {
		return null;
	}
}

export function writeMarkdownOutlineVisible(
	visible: boolean,
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): void {
	const encoded = visible ? "true" : "false";
	if (stablePreferences) {
		try {
			stablePreferences.setItem(MARKDOWN_OUTLINE_VISIBLE_KEY, encoded);
		} catch {}
		return;
	}
	try {
		browserStorage()?.setItem(markdownOutlineStorageKey(getTransport().httpBase()), encoded);
	} catch {}
}
