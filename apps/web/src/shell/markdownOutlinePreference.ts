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

export type MarkdownOutlineSide = "left" | "right";

export const MARKDOWN_OUTLINE_SIDE_KEY = "markdown-outline-side";

export function parseMarkdownOutlineSide(value: string | null): MarkdownOutlineSide {
	return value === "left" ? "left" : "right";
}

function sideStorageKey(): string {
	return `${STORAGE_PREFIX}${MARKDOWN_OUTLINE_SIDE_KEY}:${getTransport().httpBase()}`;
}

export function readMarkdownOutlineSide(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): MarkdownOutlineSide {
	try {
		if (stablePreferences)
			return parseMarkdownOutlineSide(stablePreferences.getItem(MARKDOWN_OUTLINE_SIDE_KEY));
		return parseMarkdownOutlineSide(browserStorage()?.getItem(sideStorageKey()) ?? null);
	} catch {
		return "right";
	}
}

const sideListeners = new Set<() => void>();
let cachedSide: MarkdownOutlineSide | null = null;

export function writeMarkdownOutlineSide(
	side: MarkdownOutlineSide,
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): void {
	try {
		if (stablePreferences) stablePreferences.setItem(MARKDOWN_OUTLINE_SIDE_KEY, side);
		else browserStorage()?.setItem(sideStorageKey(), side);
	} catch {}
	cachedSide = side;
	for (const listener of sideListeners) listener();
}

export function subscribeMarkdownOutlineSide(listener: () => void): () => void {
	sideListeners.add(listener);
	return () => sideListeners.delete(listener);
}

export function markdownOutlineSideSnapshot(): MarkdownOutlineSide {
	cachedSide ??= readMarkdownOutlineSide();
	return cachedSide;
}
