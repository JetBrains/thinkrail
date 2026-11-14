import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { WsErrorCode } from "@thinkrail/contracts";

const requests: string[] = [];
let restoreFailure: WsErrorCode | null = null;
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string) => {
			requests.push(method);
			if (method === "artifacts.restore" && restoreFailure)
				return Promise.reject(new actualTransport.RequestError(restoreFailure, "refused"));
			return method === "fs.readFile" ? new Promise(() => {}) : Promise.resolve({ ok: true });
		},
	}),
}));

const { useAppStore } = await import("../store");
const { openArtifact, restoreArtifact } = await import("./artifactActions");
const initial = useAppStore.getInitialState();
const PATH = ".thinkrail/context/report.md";

beforeEach(() => {
	requests.length = 0;
	restoreFailure = null;
	useAppStore.setState(initial, true);
});
afterAll(() => useAppStore.setState(initial, true));

test("opening a deleted artifact restores it before reading it", async () => {
	void openArtifact("w1", PATH, "preview", () => restoreArtifact("w1", PATH));
	await new Promise((resolve) => setTimeout(resolve, 0));
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
