import { expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import {
	initFilesTreePersistence,
	parseFilesTreeDocument,
	serializeFilesTreeDocument,
} from "./filesTreeState";

function memoryAdapter(initial: string | null): StablePreferenceAdapter & { value: string | null } {
	const adapter = {
		value: initial,
		getItem: () => adapter.value,
		setItem: (_key: string, value: string) => {
			adapter.value = value;
		},
		removeItem: () => {
			adapter.value = null;
		},
	};
	return adapter;
}

test("the stored files-tree document round-trips and drops malformed parts", () => {
	const views = {
		w1: {
			expanded: ["src", "src/auth"],
			changedCollapsed: ["apps"],
			scroll: { all: { top: 40, scope: "" }, changedTree: { top: 8, scope: "branch" } },
			seenActivePath: "src/auth/login.ts",
		},
	};
	expect(parseFilesTreeDocument(serializeFilesTreeDocument(views))).toEqual(views);
	expect(parseFilesTreeDocument(null)).toEqual({});
	expect(parseFilesTreeDocument("{not json")).toEqual({});
	expect(parseFilesTreeDocument(JSON.stringify({ version: 2, workspaces: views }))).toEqual({});
	expect(
		parseFilesTreeDocument(
			JSON.stringify({
				version: 1,
				workspaces: {
					w1: { expanded: ["src", 3], scroll: { all: { top: -1, scope: "" }, bogus: 1 } },
					w2: "nope",
				},
			}),
		),
	).toEqual({ w1: { expanded: ["src"], changedCollapsed: [], scroll: {}, seenActivePath: null } });
});

test("persistence hydrates the store and writes later changes back", () => {
	const adapter = memoryAdapter(
		serializeFilesTreeDocument({
			w1: { expanded: ["src"], changedCollapsed: [], scroll: {}, seenActivePath: null },
		}),
	);
	useAppStore.setState({ filesTreeByWorkspace: {}, removedWorkspaceIds: Object.create(null) });
	const dispose = initFilesTreePersistence(adapter);
	expect(useAppStore.getState().filesTreeByWorkspace.w1?.expanded).toEqual(["src"]);

	useAppStore.getState().setFilesTreeExpanded("w1", ["src/auth"], true);
	dispose();
	expect(parseFilesTreeDocument(adapter.value).w1?.expanded).toEqual(["src", "src/auth"]);
});
