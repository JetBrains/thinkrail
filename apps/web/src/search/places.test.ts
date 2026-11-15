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
		workspaces: { p1: [{ id: "w1", projectId: "p1" }] },
		sessionStateByWorkspace: {},
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

	test("a chat without a project is its one chat, before its layout resolves and on any other tab", () => {
		const chatFolder = {
			...inWorkspace("t-term"),
			activeWorkspaceId: "c1",
			workspaces: { chats: [{ id: "c1", projectId: "chats", kind: "chat" }] },
			sessionStateByWorkspace: { c1: { "s-c1": {} } },
		} as unknown as PlaceState;
		expect(currentPlaceIds(chatFolder)).toEqual(["chat:s-c1", "workspace:c1"]);
		expect(
			currentPlaceIds({ ...chatFolder, sessionStateByWorkspace: {} } as unknown as PlaceState),
		).toEqual(["workspace:c1"]);
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
