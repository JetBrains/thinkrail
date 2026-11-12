import { afterEach, expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { initMarkdownOutlinePersistence } from "./markdownOutlinePreference";

function memoryAdapter(initial: Record<string, string> = {}): StablePreferenceAdapter & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
	useAppStore.setState({ markdownOutlineVisible: null, markdownOutlineSide: "right" });
});

test("an untouched client keeps the width-driven default and the right edge", () => {
	stop = initMarkdownOutlinePersistence(memoryAdapter({ "markdown-outline-side": "middle" }));
	expect(useAppStore.getState().markdownOutlineVisible).toBeNull();
	expect(useAppStore.getState().markdownOutlineSide).toBe("right");
});

test("stored choices hydrate the store and later changes are written back", () => {
	const adapter = memoryAdapter({
		"markdown-outline-visible": "false",
		"markdown-outline-side": "left",
	});
	stop = initMarkdownOutlinePersistence(adapter);
	expect(useAppStore.getState().markdownOutlineVisible).toBe(false);
	expect(useAppStore.getState().markdownOutlineSide).toBe("left");

	useAppStore.getState().setMarkdownOutlineVisible(true);
	useAppStore.getState().setMarkdownOutlineSide("right");
	expect(adapter.values.get("markdown-outline-visible")).toBe("true");
	expect(adapter.values.get("markdown-outline-side")).toBe("right");
});
