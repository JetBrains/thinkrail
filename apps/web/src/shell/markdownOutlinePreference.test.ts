import { expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import {
	MARKDOWN_OUTLINE_VISIBLE_KEY,
	markdownOutlineStorageKey,
	parseMarkdownOutlineVisible,
	readMarkdownOutlineVisible,
	writeMarkdownOutlineVisible,
} from "./markdownOutlinePreference";

function memoryAdapter(initial: string | null = null): StablePreferenceAdapter & {
	value: string | null;
} {
	return {
		value: initial,
		getItem() {
			return this.value;
		},
		setItem(_key: string, value: string) {
			this.value = value;
		},
		removeItem() {
			this.value = null;
		},
	};
}

test("parseMarkdownOutlineVisible accepts only explicit booleans", () => {
	expect(parseMarkdownOutlineVisible("true")).toBe(true);
	expect(parseMarkdownOutlineVisible("false")).toBe(false);
	expect(parseMarkdownOutlineVisible(null)).toBeNull();
	expect(parseMarkdownOutlineVisible("yes")).toBeNull();
});

test("the host-qualified browser key is namespaced", () => {
	expect(markdownOutlineStorageKey("http://localhost:31415")).toBe(
		`thinkrail-markdown-outline-visible:http://localhost:31415`,
	);
});

test("read and write go through the stable preference adapter", () => {
	const adapter = memoryAdapter();
	expect(readMarkdownOutlineVisible(adapter)).toBeNull();
	writeMarkdownOutlineVisible(true, adapter);
	expect(adapter.value).toBe("true");
	expect(readMarkdownOutlineVisible(adapter)).toBe(true);
	writeMarkdownOutlineVisible(false, adapter);
	expect(readMarkdownOutlineVisible(adapter)).toBe(false);
	expect(adapter.getItem(MARKDOWN_OUTLINE_VISIBLE_KEY)).toBe("false");
});
