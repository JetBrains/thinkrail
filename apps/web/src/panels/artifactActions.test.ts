import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { WorkspaceArtifact, WsErrorCode } from "@thinkrail/contracts";

const requests: string[] = [];
let restoreFailure: WsErrorCode | null = null;
let restoreGate: Promise<void> = Promise.resolve();
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: async (method: string) => {
			requests.push(method);
			if (method === "fs.readFile") return new Promise(() => {});
			if (method === "artifacts.restore") {
				await restoreGate;
				if (restoreFailure) throw new actualTransport.RequestError(restoreFailure, "refused");
			}
			return { ok: true };
		},
	}),
}));

const { useAppStore } = await import("../store");
const { artifactRestorer, openArtifact, restoreArtifact } = await import("./artifactActions");
const initial = useAppStore.getInitialState();
const PATH = ".thinkrail/context/report.md";
const deleted = (): WorkspaceArtifact => ({
	path: PATH,
	state: "deleted",
	size: 1,
	changedAt: 1,
	firstSeenAt: 1,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	requests.length = 0;
	restoreFailure = null;
	restoreGate = Promise.resolve();
	useAppStore.setState(initial, true);
});
afterAll(() => useAppStore.setState(initial, true));

test("opening a deleted artifact restores it before reading it", async () => {
	void openArtifact("w1", PATH, "preview", () => restoreArtifact("w1", PATH));
	await settle();
	expect(requests).toEqual(["artifacts.restore", "fs.readFile"]);
	expect(useAppStore.getState().toasts).toEqual([]);
});

test("a deleted artifact whose path is taken again opens nothing and says why", async () => {
	restoreFailure = "ENTRY_EXISTS";
	await openArtifact("w1", PATH, "keep", () => restoreArtifact("w1", PATH));
	expect(requests).toEqual(["artifacts.restore"]);
	expect(useAppStore.getState().toasts).toEqual([
		expect.objectContaining({
			variant: "error",
			title: "Couldn't restore",
			message: "report.md exists again, so its kept copy was not restored.",
		}),
	]);
});

test("a click made while a deleted artifact restores keeps its place: the restored preview does not open", async () => {
	let release = () => {};
	restoreGate = new Promise((resolve) => {
		release = resolve;
	});
	useAppStore.getState().setLayoutAttention("w1", {
		selectedByGroup: {},
		lastFocusedCenterGroupId: "center",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: { center: 0 },
	});
	const opened = openArtifact("w1", PATH, "preview", () => restoreArtifact("w1", PATH));
	useAppStore.getState().beginCenterNavigation("w1");
	release();
	await opened;
	expect(requests).toEqual(["artifacts.restore"]);
});

test("a row asks for one restore, in flight or done, until a newer snapshot of it arrives", async () => {
	let release = () => {};
	restoreGate = new Promise((resolve) => {
		release = resolve;
	});
	const restore = artifactRestorer("w1");
	const record = deleted();
	const first = restore(record);
	expect(restore(record)).toBe(first);
	release();
	expect(await first).toBe(true);
	expect(await restore(record)).toBe(true);
	expect(requests).toEqual(["artifacts.restore"]);

	expect(await restore(deleted())).toBe(true);
	expect(requests).toEqual(["artifacts.restore", "artifacts.restore"]);
});

test("a failed restore is asked again on the next open", async () => {
	restoreFailure = "ARTIFACT_UNKNOWN";
	const restore = artifactRestorer("w1");
	const record = deleted();
	expect(await restore(record)).toBe(false);
	restoreFailure = null;
	expect(await restore(record)).toBe(true);
	expect(requests).toEqual(["artifacts.restore", "artifacts.restore"]);
});
