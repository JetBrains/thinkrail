import { beforeEach, describe, expect, test } from "bun:test";
import type {
	LayoutChangedPayload,
	LayoutReplaceParams,
	WorkspaceLayoutDocument,
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import {
	commitWorkspaceLayout,
	hydrateWorkspaceLayout,
	resetLayoutSyncForTests,
	setLayoutReplaceRequesterForTests,
} from "../shell/layoutSync";
import { useAppStore } from "./appStore";

function document(tabId: string): WorkspaceLayoutDocument {
	return {
		version: 1,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: tabId, name: tabId, path: tabId }],
		},
		left: { visible: false, width: 0.18, groups: [] },
		right: { visible: false, width: 0.28, groups: [] },
		toolRestoreTargets: {},
	};
}

function snapshot(revision: number, tabId: string): WorkspaceLayoutSnapshot {
	return { workspaceId: "ws", revision, document: document(tabId) };
}

beforeEach(() => {
	resetLayoutSyncForTests();
	useAppStore.setState({
		removedWorkspaceIds: {},
		layoutSnapshotsByWorkspace: {},
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutPendingByWorkspace: {},
		layoutRemoteEpochByWorkspace: {},
		layoutIntents: [],
		toasts: [],
	});
});

describe("synchronized layout store", () => {
	test("keeps accepted state separate from the latest ordered optimistic projection", () => {
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(1, "accepted"));
		store.beginLayoutCommit("ws", document("first"), "m1");
		store.beginLayoutCommit("ws", document("second"), "m2");
		expect(useAppStore.getState().layoutDocumentsByWorkspace.ws).toEqual(document("second"));

		store.installLayoutSnapshot(snapshot(2, "first"), "m1");
		const afterFirst = useAppStore.getState();
		expect(afterFirst.layoutSnapshotsByWorkspace.ws).toEqual(snapshot(2, "first"));
		expect(afterFirst.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(afterFirst.layoutPendingByWorkspace.ws?.map((write) => write.mutationId)).toEqual([
			"m2",
		]);

		store.installLayoutSnapshot(snapshot(3, "second"), "m2");
		const settled = useAppStore.getState();
		expect(settled.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(settled.layoutPendingByWorkspace.ws).toEqual([]);
		expect(settled.layoutRemoteEpochByWorkspace.ws).toBe(1); // initial host read only
	});

	test("a later acknowledgement settles the accepted pending prefix even if an earlier reply was lost", () => {
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(1, "accepted"));
		store.beginLayoutCommit("ws", document("first"), "m1");
		store.beginLayoutCommit("ws", document("second"), "m2");
		store.installLayoutSnapshot(snapshot(3, "second"), "m2");
		const state = useAppStore.getState();
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
	});

	test("settles a matching acknowledgement even when its document revision is already stale", () => {
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(4, "accepted"));
		store.beginLayoutCommit("ws", document("pending"), "mine");
		store.installLayoutSnapshot(snapshot(5, "remote"), "other");
		expect(useAppStore.getState().layoutRemoteEpochByWorkspace.ws).toBe(2);
		store.installLayoutSnapshot(snapshot(4, "old-ack"), "mine");
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toEqual(snapshot(5, "remote"));
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("remote"));
	});

	test("rejecting a write discards dependent later projections and restores accepted state", () => {
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(1, "accepted"));
		store.beginLayoutCommit("ws", document("first"), "m1");
		store.beginLayoutCommit("ws", document("second"), "m2");
		store.rejectLayoutCommit("ws", "m1");
		const state = useAppStore.getState();
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("accepted"));
		expect(state.layoutRemoteEpochByWorkspace.ws).toBe(2);
	});

	test("serializes writes per workspace and prevents a rolled-back dependent write reaching the host", async () => {
		type PendingRequest = {
			params: LayoutReplaceParams;
			resolve: (payload: LayoutChangedPayload) => void;
			reject: (error: Error) => void;
		};
		const requests: PendingRequest[] = [];
		setLayoutReplaceRequesterForTests(
			(params) =>
				new Promise((resolve, reject) => {
					requests.push({ params, resolve, reject });
				}),
		);
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(1, "accepted"));
		store.installLayoutSnapshot({
			workspaceId: "other",
			revision: 1,
			document: document("other-accepted"),
		});

		const first = commitWorkspaceLayout("ws", document("first")).then(
			() => "fulfilled",
			(error: Error) => error,
		);
		const dependent = commitWorkspaceLayout("ws", document("dependent")).then(
			() => "fulfilled",
			(error: Error) => error,
		);
		const independent = commitWorkspaceLayout("other", document("other-next"));
		await Bun.sleep(0);
		expect(requests.map((request) => request.params.workspaceId)).toEqual(["ws", "other"]);

		const otherRequest = requests.find((request) => request.params.workspaceId === "other");
		if (!otherRequest) throw new Error("missing independent layout request");
		otherRequest.resolve({
			snapshot: {
				workspaceId: "other",
				revision: 2,
				document: otherRequest.params.document,
			},
			mutationId: otherRequest.params.mutationId,
		});
		await independent;

		const firstRequest = requests.find((request) => request.params.workspaceId === "ws");
		if (!firstRequest) throw new Error("missing first layout request");
		firstRequest.reject(new Error("host rejected first write"));
		const firstResult = await first;
		expect(firstResult).toBeInstanceOf(Error);
		expect((firstResult as Error).message).toBe("host rejected first write");
		const dependentResult = await dependent;
		expect(dependentResult).toBeInstanceOf(Error);
		expect((dependentResult as Error).name).toBe("SupersededLayoutCommitError");
		expect(requests).toHaveLength(2);
		expect(useAppStore.getState().layoutDocumentsByWorkspace.ws).toEqual(document("accepted"));
		expect(useAppStore.getState().layoutPendingByWorkspace.ws).toEqual([]);
	});

	test("a matching broadcast wins over a lost response without a false rollback", async () => {
		let pending:
			| {
					params: LayoutReplaceParams;
					reject: (error: Error) => void;
			  }
			| undefined;
		setLayoutReplaceRequesterForTests(
			(params) =>
				new Promise((_resolve, reject) => {
					pending = { params, reject };
				}),
		);
		useAppStore.getState().installLayoutSnapshot(snapshot(1, "accepted"));
		const committed = commitWorkspaceLayout("ws", document("next"));
		await Bun.sleep(0);
		if (!pending) throw new Error("missing layout request");
		const accepted = {
			workspaceId: "ws",
			revision: 2,
			document: pending.params.document,
		};
		useAppStore.getState().applyLayoutChanged({
			snapshot: accepted,
			mutationId: pending.params.mutationId,
		});
		pending.reject(new Error("response was lost after broadcast"));

		await expect(committed).resolves.toEqual(accepted);
		const state = useAppStore.getState();
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("next"));
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.toasts).toEqual([]);
	});

	test("removed workspaces reject hydration before issuing any transport work", async () => {
		useAppStore.setState({ removedWorkspaceIds: { ws: true } });
		await expect(hydrateWorkspaceLayout("ws")).rejects.toThrow("Workspace has been removed");
	});

	test("a failed first seed removes its unaccepted optimistic document", () => {
		const store = useAppStore.getState();
		store.beginLayoutCommit("ws", document("seed"), "seed");
		store.rejectLayoutCommit("ws", "seed");
		expect(useAppStore.getState().layoutDocumentsByWorkspace.ws).toBeUndefined();
		expect(useAppStore.getState().layoutRemoteEpochByWorkspace.ws).toBe(1);
	});
});
