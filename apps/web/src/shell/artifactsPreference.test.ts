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
	useAppStore.setState({
		artifactsSeenByWorkspace: {},
		artifactsShowIgnored: true,
		artifactsView: "list",
		artifactsTreeExpandedByWorkspace: {},
	});
});

test("an untouched client shows ignored outputs and has seen nothing", () => {
	stop = initArtifactsPersistence(
		memoryAdapter({
			"artifacts-seen": "not json",
			"artifacts-view": "grid",
			"artifacts-tree-expanded": "[]",
		}),
	);
	expect(useAppStore.getState().artifactsShowIgnored).toBe(true);
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({});
	expect(useAppStore.getState().artifactsView).toBe("list");
	expect(useAppStore.getState().artifactsTreeExpandedByWorkspace).toEqual({});
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

test("the view and each workspace's open folders are remembered", () => {
	const adapter = memoryAdapter({
		"artifacts-view": "tree",
		"artifacts-tree-expanded": JSON.stringify({ w1: ["a", 1, "a/b"], w2: "bad", w3: [] }),
	});
	stop = initArtifactsPersistence(adapter);
	const store = useAppStore.getState();
	expect(store.artifactsView).toBe("tree");
	expect(store.artifactsTreeExpandedByWorkspace).toEqual({ w1: ["a", "a/b"] });
	store.setArtifactsView("list");
	store.setArtifactsTreeExpanded("w2", ["x", "x/y"], true);
	store.setArtifactsTreeExpanded("w1", ["a/b"], false);
	expect(adapter.values.get("artifacts-view")).toBe("list");
	expect(JSON.parse(adapter.values.get("artifacts-tree-expanded") ?? "{}")).toEqual({
		w1: ["a"],
		w2: ["x", "x/y"],
	});
	useAppStore.getState().collapseAllArtifacts("w2");
	expect(JSON.parse(adapter.values.get("artifacts-tree-expanded") ?? "{}")).toEqual({
		w1: ["a"],
	});
});
