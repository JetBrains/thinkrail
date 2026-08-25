import { beforeEach, describe, expect, test } from "bun:test";
import type {
	LayoutReplaceParams,
	LayoutReplaceResult,
	WorkspaceLayoutDocument,
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import { useAppStore } from "../../store";
import {
	commitWorkspaceLayout,
	hydrateWorkspaceLayout,
	resetLayoutSyncForTests,
	setLayoutReplaceRequesterForTests,
} from "./index";

function document(tabId: string): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: tabId, name: tabId, path: tabId }],
		},
		left: { visible: false, width: 0.18, groups: [] },
		right: { visible: false, width: 0.28, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

function snapshot(revision: number, tabId: string): WorkspaceLayoutSnapshot {
	return { workspaceId: "ws", revision, document: document(tabId) };
}

type PendingRequest = {
	params: LayoutReplaceParams;
	resolve: (result: LayoutReplaceResult) => void;
	reject: (error: Error) => void;
};

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
		const optimistic = useAppStore.getState();
		expect(optimistic.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(optimistic.layoutPendingByWorkspace.ws?.map((write) => write.expectedRevision)).toEqual([
			1, 2,
		]);

		store.installLayoutSnapshot(snapshot(2, "first"), "m1");
		const afterFirst = useAppStore.getState();
		expect(afterFirst.layoutSnapshotsByWorkspace.ws).toEqual(snapshot(2, "first"));
		expect(afterFirst.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(afterFirst.layoutPendingByWorkspace.ws).toMatchObject([
			{ mutationId: "m2", expectedRevision: 2 },
		]);

		store.installLayoutSnapshot(snapshot(3, "second"), "m2");
		const settled = useAppStore.getState();
		expect(settled.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(settled.layoutPendingByWorkspace.ws).toEqual([]);
		expect(settled.layoutRemoteEpochByWorkspace.ws).toBe(1);
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
		expect(requests.map((request) => request.params.expectedRevision)).toEqual([1, 1]);

		const otherRequest = requests.find((request) => request.params.workspaceId === "other");
		if (!otherRequest) throw new Error("missing independent layout request");
		otherRequest.resolve({
			status: "accepted",
			payload: {
				snapshot: {
					workspaceId: "other",
					revision: 2,
					document: otherRequest.params.document,
				},
				mutationId: otherRequest.params.mutationId,
			},
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

	test("two dependent commits succeed in captured revision order", async () => {
		const requests: PendingRequest[] = [];
		setLayoutReplaceRequesterForTests(
			(params) =>
				new Promise((resolve, reject) => {
					requests.push({ params, resolve, reject });
				}),
		);
		useAppStore.getState().installLayoutSnapshot(snapshot(1, "accepted"));
		const first = commitWorkspaceLayout("ws", document("first"));
		const second = commitWorkspaceLayout("ws", document("second"));
		await Bun.sleep(0);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.params.expectedRevision).toBe(1);
		const firstRequest = requests[0];
		if (!firstRequest) throw new Error("missing first request");
		firstRequest.resolve({
			status: "accepted",
			payload: {
				snapshot: { workspaceId: "ws", revision: 2, document: firstRequest.params.document },
				mutationId: firstRequest.params.mutationId,
			},
		});
		await first;
		await Bun.sleep(0);

		expect(requests).toHaveLength(2);
		const secondRequest = requests[1];
		if (!secondRequest) throw new Error("missing second request");
		expect(secondRequest.params.expectedRevision).toBe(2);
		secondRequest.resolve({
			status: "accepted",
			payload: {
				snapshot: { workspaceId: "ws", revision: 3, document: secondRequest.params.document },
				mutationId: secondRequest.params.mutationId,
			},
		});
		await expect(second).resolves.toEqual(snapshot(3, "second"));
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toEqual(snapshot(3, "second"));
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("second"));
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
	});

	test("a remote write between dependent commits conflicts and cancels later projections", async () => {
		const requests: PendingRequest[] = [];
		setLayoutReplaceRequesterForTests(
			(params) =>
				new Promise((resolve, reject) => {
					requests.push({ params, resolve, reject });
				}),
		);
		useAppStore.getState().installLayoutSnapshot(snapshot(1, "accepted"));
		const first = commitWorkspaceLayout("ws", document("first"));
		const conflicting = commitWorkspaceLayout("ws", document("conflicting")).then(
			() => "fulfilled",
			(error: Error) => error,
		);
		const dependent = commitWorkspaceLayout("ws", document("dependent")).then(
			() => "fulfilled",
			(error: Error) => error,
		);
		await Bun.sleep(0);
		const firstRequest = requests[0];
		if (!firstRequest) throw new Error("missing first request");
		firstRequest.resolve({
			status: "accepted",
			payload: {
				snapshot: { workspaceId: "ws", revision: 2, document: firstRequest.params.document },
				mutationId: firstRequest.params.mutationId,
			},
		});
		const remote = snapshot(3, "remote");
		useAppStore.getState().applyLayoutChanged({ snapshot: remote, mutationId: "remote-client" });
		await first;
		await Bun.sleep(0);

		expect(requests).toHaveLength(2);
		const staleRequest = requests[1];
		if (!staleRequest) throw new Error("missing stale dependent request");
		expect(staleRequest.params.expectedRevision).toBe(2);
		staleRequest.resolve({ status: "conflict", current: remote });

		const conflictResult = await conflicting;
		expect(conflictResult).toBeInstanceOf(Error);
		expect((conflictResult as Error).name).toBe("LayoutCommitConflictError");
		const dependentResult = await dependent;
		expect(dependentResult).toBeInstanceOf(Error);
		expect((dependentResult as Error).name).toBe("SupersededLayoutCommitError");
		expect(requests).toHaveLength(2);
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toEqual(remote);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(document("remote"));
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.toasts).toEqual([]);
	});

	test("a delayed conflict response cannot regress a newer accepted broadcast", () => {
		const store = useAppStore.getState();
		store.installLayoutSnapshot(snapshot(1, "accepted"));
		store.beginLayoutCommit("ws", document("optimistic"), "mine");
		const newer = snapshot(3, "newer-remote");
		store.applyLayoutChanged({ snapshot: newer, mutationId: "remote-client" });

		store.applyLayoutConflict("ws", "mine", snapshot(2, "conflict-time-current"));
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toEqual(newer);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(newer.document);
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
	});

	test("a delayed absent conflict cannot erase a creation broadcast that overtook it", () => {
		const store = useAppStore.getState();
		store.beginLayoutCommit("ws", document("optimistic-create"), "mine");
		const created = snapshot(1, "remote-create");
		store.applyLayoutChanged({ snapshot: created, mutationId: "remote-client" });

		store.applyLayoutConflict("ws", "mine", null);
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toEqual(created);
		expect(state.layoutDocumentsByWorkspace.ws).toEqual(created.document);
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
	});

	test("a conflict can install authoritative absence and rolls back the optimistic document", async () => {
		let pending:
			| {
					params: LayoutReplaceParams;
					resolve: (result: LayoutReplaceResult) => void;
			  }
			| undefined;
		setLayoutReplaceRequesterForTests(
			(params) =>
				new Promise((resolve) => {
					pending = { params, resolve };
				}),
		);
		useAppStore.getState().installLayoutSnapshot(snapshot(1, "stale-local"));
		const committed = commitWorkspaceLayout("ws", document("optimistic")).then(
			() => "fulfilled",
			(error: Error) => error,
		);
		await Bun.sleep(0);
		if (!pending) throw new Error("missing layout request");
		pending.resolve({ status: "conflict", current: null });
		const result = await committed;
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).name).toBe("LayoutCommitConflictError");
		const state = useAppStore.getState();
		expect(state.layoutSnapshotsByWorkspace.ws).toBeUndefined();
		expect(state.layoutDocumentsByWorkspace.ws).toBeUndefined();
		expect(state.layoutPendingByWorkspace.ws).toEqual([]);
		expect(state.toasts).toEqual([]);
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
		expect(pending.params.expectedRevision).toBe(1);
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
		expect(useAppStore.getState().layoutPendingByWorkspace.ws?.[0]?.expectedRevision).toBeNull();
		store.rejectLayoutCommit("ws", "seed");
		expect(useAppStore.getState().layoutDocumentsByWorkspace.ws).toBeUndefined();
		expect(useAppStore.getState().layoutRemoteEpochByWorkspace.ws).toBe(1);
	});
});
