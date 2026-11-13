import { beforeEach, expect, test } from "bun:test";
import { ARTIFACTS_PROTOCOL_VERSION, type WorkspaceArtifactsSnapshot } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import { selectArtifactsTick, supportsArtifacts } from "./selectors";

const snapshot = (firstSeenAt: number): WorkspaceArtifactsSnapshot => ({
	workspaceId: "w1",
	dir: ".thinkrail/context",
	artifacts: [
		{ path: ".thinkrail/context/a.md", state: "live", size: 1, changedAt: 1, firstSeenAt },
	],
	outputs: null,
});

beforeEach(() => {
	useAppStore.setState({
		artifactsByWorkspace: {},
		artifactsTickByWorkspace: {},
		artifactsSeenByWorkspace: {},
		removedWorkspaceIds: {},
		connectionGeneration: 0,
	});
});

test("the first snapshot of a workspace counts as seen; later arrivals are unseen until marked", () => {
	const store = useAppStore.getState();
	store.setWorkspaceArtifacts("w1", snapshot(10));
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({ w1: 10 });
	store.setWorkspaceArtifacts("w1", snapshot(20));
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({ w1: 10 });
	store.markArtifactsSeen("w1", 20);
	store.markArtifactsSeen("w1", 15);
	expect(useAppStore.getState().artifactsSeenByWorkspace).toEqual({ w1: 20 });
});

test("a change nudge or a reconnect changes the read tick", () => {
	const before = selectArtifactsTick(useAppStore.getState(), "w1");
	useAppStore.getState().noteArtifactsChanged("w1");
	const nudged = selectArtifactsTick(useAppStore.getState(), "w1");
	expect(nudged).not.toBe(before);
	useAppStore.setState({ connectionGeneration: 1 });
	expect(selectArtifactsTick(useAppStore.getState(), "w1")).not.toBe(nudged);
});

test("a removed workspace takes no snapshot", () => {
	useAppStore.setState({ removedWorkspaceIds: { w1: true } });
	useAppStore.getState().setWorkspaceArtifacts("w1", snapshot(10));
	useAppStore.getState().noteArtifactsChanged("w1");
	expect(useAppStore.getState().artifactsByWorkspace).toEqual({});
	expect(useAppStore.getState().artifactsTickByWorkspace).toEqual({});
});

test("artifacts, Cut and Paste into artifacts wait for a host that serves them", () => {
	expect(supportsArtifacts(null)).toBe(false);
	expect(supportsArtifacts(ARTIFACTS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsArtifacts(ARTIFACTS_PROTOCOL_VERSION)).toBe(true);
});
