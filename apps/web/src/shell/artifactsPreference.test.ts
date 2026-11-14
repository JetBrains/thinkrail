import { afterEach, expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { initArtifactsPersistence } from "./artifactsPreference";

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
	useAppStore.setState({ artifactsSeenByWorkspace: {}, artifactsShowIgnored: true });
});

test("an untouched client shows ignored outputs and has seen nothing", () => {
	stop = initArtifactsPersistence(memoryAdapter({ "artifacts-seen": "not json" }));
	expect(useAppStore.getState().artifactsShowIgnored).toBe(true);
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({});
});

test("stored choices hydrate the store and later changes are written back", () => {
	const adapter = memoryAdapter({
		"artifacts-seen": JSON.stringify({ w1: 10, w2: "bad" }),
		"artifacts-show-ignored": "false",
	});
	stop = initArtifactsPersistence(adapter);
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({ w1: 10 });
	expect(useAppStore.getState().artifactsShowIgnored).toBe(false);
	useAppStore.getState().markArtifactsSeen("w1", 20);
	useAppStore.getState().setArtifactsShowIgnored(true);
	expect(JSON.parse(adapter.values.get("artifacts-seen") ?? "{}")).toEqual({ w1: 20 });
	expect(adapter.values.get("artifacts-show-ignored")).toBe("true");
});
