import { beforeEach, describe, expect, test } from "bun:test";
import { layoutResourceIdentity } from "../lib";
import { type ExtensionTab, selectPanelViewState, useAppStore } from "../store";
import { releaseClosedTab } from "./closedTab";
import type { LayoutExtensionTab } from "./layout";

const restored: LayoutExtensionTab = {
	kind: "extension",
	id: "restored-tab",
	name: "Session insights",
	extension: "insights",
	panel: "sessions",
	titleKey: "common.retry",
	params: { projectId: "p1" },
};
const key = layoutResourceIdentity(restored);

beforeEach(() => {
	useAppStore.setState({
		activeWorkspaceId: "w1",
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		previewTabByWorkspace: {},
		layoutIntents: [],
		removedWorkspaceIds: {},
		panelViewStatesByWorkspace: {
			w1: {
				[key]: { state: { section: "files" }, epoch: 1 },
				other: { state: { kept: true }, epoch: 0 },
			},
		},
	});
});

describe("releasing a closed tab", () => {
	test("an extension tab restored from the layout, with no tab cache, drops its view state", () => {
		releaseClosedTab("w1", restored);

		expect(selectPanelViewState(useAppStore.getState(), "w1", key)).toBeUndefined();
		expect(useAppStore.getState().panelViewStatesByWorkspace.w1?.[key]).toBeUndefined();
		expect(selectPanelViewState(useAppStore.getState(), "w1", "other")).toEqual({ kept: true });
	});

	test("a cached extension tab goes with its cache and its view state", () => {
		const cached: ExtensionTab = { ...restored, id: "cached-tab", workspaceId: "w1" };
		useAppStore.setState({ tabsByWorkspace: { w1: [cached] } });

		releaseClosedTab("w1", { ...restored, id: "placed-tab" });

		expect(useAppStore.getState().tabsByWorkspace.w1).toEqual([]);
		expect(useAppStore.getState().panelViewStatesByWorkspace.w1?.[key]).toBeUndefined();
	});
});
