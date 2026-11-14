import { describe, expect, test } from "bun:test";
import { currentPlaceIds, type PlaceState } from "./places";

const chat = (id: string, sessionId: string) => ({
	kind: "chat" as const,
	id,
	name: id,
	sessionId,
});

const inWorkspace = (selected: string) =>
	({
		activeWorkspaceId: "w1",
		selectedProjectId: "p1",
		layoutDocumentsByWorkspace: {
			w1: {
				center: {
					kind: "group" as const,
					id: "center",
					tabs: [chat("t-a", "a"), { kind: "terminal" as const, id: "t-term", name: "zsh" }],
				},
			},
		},
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: { center: selected },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: {},
			},
		},
	}) as unknown as PlaceState;

describe("currentPlaceIds", () => {
	test("the selected chat tab is the place, standing for its workspace", () => {
		expect(currentPlaceIds(inWorkspace("t-a"))).toEqual(["chat:a", "workspace:w1"]);
	});

	test("a workspace showing another tab, Project Home and the main screen", () => {
		expect(currentPlaceIds(inWorkspace("t-term"))).toEqual(["workspace:w1"]);
		expect(currentPlaceIds({ ...inWorkspace("t-a"), activeWorkspaceId: null })).toEqual([
			"project:p1",
		]);
		expect(
			currentPlaceIds({ ...inWorkspace("t-a"), activeWorkspaceId: null, selectedProjectId: null }),
		).toEqual([]);
	});
});
