import { afterEach, beforeEach, expect, test } from "bun:test";
import { SEARCH_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { PALETTE_PREVIEW_HOST, PEEK_HOST } from "./AppResourceHost";

const initial = useAppStore.getInitialState();

beforeEach(() => useAppStore.setState(initial, true));
afterEach(() => useAppStore.setState(initial, true));

const welcome = (protocolVersion: number) =>
	useAppStore.setState((state) => ({
		protocolVersion,
		welcomeProtocolVersion: protocolVersion,
		welcomeGeneration: state.welcomeGeneration + 1,
	}));

test("the palette's preview host reads and refreshes only once the current host serves capped reads", async () => {
	const refreshes: (readonly string[] | null)[] = [];
	const stop = PALETTE_PREVIEW_HOST.subscribeFileChanges("w1", (paths) => refreshes.push(paths));
	try {
		useAppStore.setState({ status: "connected", connectionGeneration: 1 });
		expect(refreshes).toEqual([]);
		await expect(PALETTE_PREVIEW_HOST.readFile("w1", "a.ts")).rejects.toThrow("Reconnect");
		welcome(SEARCH_PROTOCOL_VERSION);
		expect(refreshes).toEqual([null]);

		useAppStore.setState({ status: "disconnected", protocolVersion: null });
		useAppStore.setState({ status: "connected", connectionGeneration: 2 });
		expect(refreshes).toEqual([null]);
		welcome(SEARCH_PROTOCOL_VERSION - 1);
		expect(refreshes).toEqual([null]);
		await expect(PALETTE_PREVIEW_HOST.readFile("w1", "a.ts")).rejects.toThrow("Reconnect");
	} finally {
		stop();
	}
});

test("the Peek host keeps a document's own links in Peek, under the same opener chat", () => {
	useAppStore.getState().requestPeek("w1", { kind: "file", path: "guide.md", sessionId: "s1" });
	PEEK_HOST.openFile("w1", "docs/next.md");
	expect(useAppStore.getState().peekByWorkspace.w1).toMatchObject({
		stack: [
			{ kind: "file", path: "guide.md", sessionId: "s1" },
			{ kind: "file", path: "docs/next.md", sessionId: "s1" },
		],
		index: 1,
		open: true,
	});
});
