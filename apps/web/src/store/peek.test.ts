import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type SessionState, type Workspace } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import { PEEK_STACK_LIMIT, type PeekEntry } from "./peek";
import { selectPeekEntry, selectPeekOpen } from "./selectors";

const initial = useAppStore.getInitialState();
const WS = "w1";

const workspace: Workspace = {
	id: WS,
	projectId: "p1",
	name: "feature",
	branch: "feature",
	worktreePath: "/repo/wt",
	baseBranch: "main",
	renamed: true,
};

beforeEach(() => useAppStore.setState({ ...initial, workspaces: { p1: [workspace] } }, true));
afterEach(() => useAppStore.setState(initial, true));

const peek = () => useAppStore.getState().peekByWorkspace[WS];
const file = (path: string, extra: Partial<Extract<PeekEntry, { kind: "file" }>> = {}) =>
	({ kind: "file", path, ...extra }) as const;
const request = (entry: PeekEntry) => useAppStore.getState().requestPeek(WS, entry);

describe("the peek stack", () => {
	test("a request opens Peek on a new entry and never emits a layout intent", () => {
		request(file("a.md"));
		request(file("b.md"));
		expect(peek()).toEqual({
			stack: [file("a.md"), file("b.md")],
			index: 1,
			pinned: false,
			open: true,
		});
		expect(useAppStore.getState().layoutIntents).toEqual([]);
		expect(selectPeekOpen(useAppStore.getState(), WS)).toBe(true);
		expect(selectPeekEntry(useAppStore.getState(), WS)).toEqual(file("b.md"));
	});

	test("peeking a resource already on the stack selects it, by resource identity", () => {
		request(file("a.md"));
		request(file("b.md"));
		request(file("/repo/wt/./a.md", { line: 4, sessionId: "s1" }));
		expect(peek()?.stack).toEqual([file("a.md", { line: 4, sessionId: "s1" }), file("b.md")]);
		expect(peek()?.index).toBe(0);
		const settled = peek();
		request(file("a.md", { line: 4, sessionId: "s1" }));
		expect(peek()).toBe(settled);
	});

	test("comparisons and extension panels dedupe on their own identity", () => {
		request({ kind: "compare", before: "a.html", after: "b.html" });
		request({ kind: "compare", before: "b.html", after: "a.html" });
		const panel = { kind: "extension", extension: "x", panel: "p", titleKey: "k" } as const;
		request({ ...panel, params: { a: "1", b: "2" } });
		request({ ...panel, params: { b: "2", a: "1" } });
		expect(peek()?.stack).toHaveLength(3);
		expect(peek()?.index).toBe(2);
	});

	test("back, forward and crumbs move within the stack and stop at its ends", () => {
		for (const path of ["a", "b", "c"]) request(file(path));
		const store = useAppStore.getState();
		store.peekForward(WS);
		expect(peek()?.index).toBe(2);
		store.peekBack(WS);
		store.peekBack(WS);
		store.peekBack(WS);
		expect(peek()?.index).toBe(0);
		store.showPeekEntry(WS, 2);
		expect(peek()?.index).toBe(2);
		store.showPeekEntry(WS, 7);
		expect(peek()?.index).toBe(2);
	});

	test("closing an entry shows its predecessor and closing the last one hides Peek", () => {
		for (const path of ["a", "b", "c"]) request(file(path));
		const store = useAppStore.getState();
		store.closePeekEntry(WS, 2);
		expect(peek()).toMatchObject({ stack: [file("a"), file("b")], index: 1, open: true });
		store.closePeekEntry(WS, 0);
		expect(peek()).toMatchObject({ stack: [file("b")], index: 0 });
		store.closePeekEntry(WS, 0);
		expect(peek()).toBeUndefined();
		expect(selectPeekOpen(useAppStore.getState(), WS)).toBe(false);
	});

	test("close hides Peek and unpins it but keeps the stack for the next request", () => {
		request(file("a"));
		useAppStore.getState().pinPeek(WS, true);
		expect(peek()?.pinned).toBe(true);
		useAppStore.getState().closePeek(WS);
		expect(peek()).toMatchObject({ open: false, pinned: false, stack: [file("a")] });
		useAppStore.getState().pinPeek(WS, true);
		expect(peek()?.pinned).toBe(false);
		request(file("b"));
		expect(peek()).toMatchObject({ open: true, index: 1, stack: [file("a"), file("b")] });
	});

	test("the stack keeps the newest entries", () => {
		for (let index = 0; index < PEEK_STACK_LIMIT + 3; index += 1) request(file(`f${index}`));
		expect(peek()?.stack).toHaveLength(PEEK_STACK_LIMIT);
		expect(peek()?.stack[0]).toEqual(file("f3"));
		expect(peek()?.index).toBe(PEEK_STACK_LIMIT - 1);
	});

	test("following replaces the entry it put there, and only while Peek still shows it", () => {
		const follow = (from: string, to: string) =>
			useAppStore.getState().followPeek(WS, file(from), file(to, { sessionId: "s1" }));
		request(file("a"));
		request(file("b", { sessionId: "s1" }));
		follow("b", "/repo/wt/c");
		expect(peek()).toMatchObject({ stack: [file("a"), file("c", { sessionId: "s1" })], index: 1 });
		follow("c", "a");
		expect(peek()).toMatchObject({ stack: [file("a", { sessionId: "s1" })], index: 0 });
		follow("b", "d");
		expect(peek()?.stack).toEqual([file("a", { sessionId: "s1" })]);
		useAppStore.getState().closePeek(WS);
		follow("a", "d");
		expect(peek()).toMatchObject({ stack: [file("a", { sessionId: "s1" })], open: false });
	});

	test("toggling the right side over an open Peek closes it and shows the right side instead", () => {
		const intents = () => useAppStore.getState().layoutIntents;
		useAppStore.getState().toggleRightSide(WS);
		expect(intents()).toMatchObject([{ kind: "toggle-side", workspaceId: WS, side: "right" }]);

		useAppStore.setState({ layoutIntents: [] });
		request(file("a"));
		useAppStore.getState().toggleRightSide(WS);
		expect(peek()).toMatchObject({ open: false, pinned: false, stack: [file("a")] });
		expect(intents()).toMatchObject([{ kind: "show-side", workspaceId: WS, side: "right" }]);

		useAppStore.setState({ layoutIntents: [] });
		request(file("b"));
		useAppStore.getState().pinPeek(WS, true);
		useAppStore.getState().toggleRightSide(WS);
		expect(peek()).toMatchObject({ open: false, pinned: false, stack: [file("a"), file("b")] });
		expect(intents()).toMatchObject([{ kind: "show-side", workspaceId: WS, side: "right" }]);
	});

	test("a removed workspace takes its Peek along and accepts no new one", () => {
		request(file("a"));
		useAppStore.getState().clearWorkspaceTabs(WS);
		expect(peek()).toBeUndefined();
		useAppStore.setState({ removedWorkspaceIds: { [WS]: true } });
		request(file("a"));
		expect(peek()).toBeUndefined();
	});
});

describe("Peek hides by itself", () => {
	const idle: SessionState = {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
	};
	const running = (runId: string, over: Partial<SessionState> = {}): SessionState => ({
		...idle,
		execution: "running",
		runId,
		...over,
	});
	const asking = running("r1", {
		needsInput: { interactionId: "i1", kind: "tool-response", toolCallId: "t1" },
	});
	const report = (state: SessionState, sessionId = "s1") =>
		useAppStore
			.getState()
			.applySessionState({ sessionId, workspaceId: WS, projectId: "p1", state });

	test("when its opener chat starts a new run", () => {
		report(idle);
		request(file("a", { sessionId: "s1" }));
		report(running("r1"));
		expect(peek()?.open).toBe(false);
		request(file("a", { sessionId: "s1" }));
		report(running("r1", { queuedCount: 1 }));
		report(idle);
		expect(peek()?.open).toBe(true);
		report(running("r2"));
		expect(peek()?.open).toBe(false);
	});

	test("when the question it previewed is answered", () => {
		report(asking);
		request(file("option.html", { sessionId: "s1" }));
		report(running("r1"));
		expect(peek()?.open).toBe(false);
	});

	test("never for another chat, an entry without an opener or a pinned Peek", () => {
		report(idle);
		report(idle, "s2");
		request(file("a", { sessionId: "s1" }));
		report(running("r1", {}), "s2");
		expect(peek()?.open).toBe(true);
		request(file("b"));
		report(running("r1"));
		expect(peek()?.open).toBe(true);
		useAppStore.getState().showPeekEntry(WS, 0);
		useAppStore.getState().pinPeek(WS, true);
		report(running("r2"));
		expect(peek()).toMatchObject({ open: true, pinned: true });
	});

	test("when a reconnect's state snapshot shows the opener working on a new run", () => {
		report(idle);
		request(file("a", { sessionId: "s1" }));
		useAppStore
			.getState()
			.installSessionStateSnapshot([
				{ sessionId: "s1", workspaceId: WS, projectId: "p1", state: running("r9") },
			]);
		expect(peek()?.open).toBe(false);
	});

	test("switching an extension off removes its entries", () => {
		const panel = (extension: string) =>
			({ kind: "extension", extension, panel: "p", params: {}, titleKey: "k" }) as const;
		request(file("a"));
		request(panel("off"));
		request(panel("on"));
		useAppStore.getState().applyConfig({ ...DEFAULT_CONFIG, disabledExtensions: ["off"] });
		expect(peek()).toMatchObject({ stack: [file("a"), panel("on")], index: 1, open: true });
		useAppStore.getState().closePeekEntry(WS, 0);
		useAppStore.getState().applyConfig({ ...DEFAULT_CONFIG, disabledExtensions: ["on"] });
		expect(peek()).toBeUndefined();
	});
});
