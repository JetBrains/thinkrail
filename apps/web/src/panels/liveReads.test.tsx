import { afterAll, beforeAll, expect, test } from "bun:test";
import { act, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAppStore } from "../store";
import { useLiveTabContent } from "./useLiveTabContent";
import { useWorkspaceRead } from "./useWorkspaceRead";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

// react-dom only touches these members when a tree renders no host elements.
beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});

function headlessContainer() {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}

async function mount(node: ReactNode) {
	const root = createRoot(headlessContainer());
	await act(async () => root.render(node));
	return {
		rerender: (next: ReactNode) => act(async () => root.render(next)),
		unmount: () => act(async () => root.unmount()),
	};
}

function scriptedReads<T>() {
	const pending: Array<{ key: string; settle: (value: T) => Promise<void> }> = [];
	const read = (key: string) =>
		new Promise<T>((resolve) => {
			pending.push({ key, settle: (value) => act(async () => resolve(value)) });
		});
	return { pending, read, keys: () => pending.map((entry) => entry.key) };
}

const tick = (workspaceId: string, paths: string[], truncated = false) =>
	act(async () => {
		useAppStore.getState().noteFsChanged({ workspaceId, paths, truncated, skillChange: "none" });
	});

function WorkspaceRead(props: {
	workspaceId: string;
	read: (id: string) => Promise<string>;
	results: string[];
	switched?: string[];
	affectedBy?: (changedPath: string) => boolean;
}) {
	useWorkspaceRead(props.workspaceId, props.read, {
		onResult: (value) => props.results.push(value),
		onSwitch: (id) => props.switched?.push(id),
		...(props.affectedBy ? { affectedBy: props.affectedBy } : {}),
	});
	return null;
}

test("a slow workspace read is not re-sent per tick, lands, and then reads once more", async () => {
	const host = scriptedReads<string>();
	const results: string[] = [];
	const view = await mount(
		<WorkspaceRead workspaceId="wr-slow" read={host.read} results={results} />,
	);
	expect(host.keys()).toEqual(["wr-slow"]);
	for (const path of ["a.ts", "b.ts", "c.ts"]) await tick("wr-slow", [path]);
	expect(host.pending).toHaveLength(1);

	await host.pending[0]?.settle("first");
	expect(results).toEqual(["first"]);
	expect(host.pending).toHaveLength(2);
	await host.pending[1]?.settle("second");
	expect(results).toEqual(["first", "second"]);
	expect(host.pending).toHaveLength(2);
	await view.unmount();
});

test("a workspace switch drops the old workspace's answer", async () => {
	const host = scriptedReads<string>();
	const results: string[] = [];
	const switched: string[] = [];
	const props = { read: host.read, results, switched };
	const view = await mount(<WorkspaceRead workspaceId="wr-old" {...props} />);
	await view.rerender(<WorkspaceRead workspaceId="wr-new" {...props} />);
	expect(switched).toEqual(["wr-old"]);
	expect(host.keys()).toEqual(["wr-old", "wr-new"]);

	await host.pending[0]?.settle("old answer");
	expect(results).toEqual([]);
	await host.pending[1]?.settle("new answer");
	expect(results).toEqual(["new answer"]);
	await view.unmount();
});

test("affectedBy skips ticks elsewhere but never a truncated or pathless one", async () => {
	const host = scriptedReads<string>();
	const results: string[] = [];
	const view = await mount(
		<WorkspaceRead
			workspaceId="wr-filter"
			read={host.read}
			results={results}
			affectedBy={(path) => path.startsWith("src/")}
		/>,
	);
	await host.pending[0]?.settle("initial");
	await tick("wr-filter", ["docs/readme.md"]);
	expect(host.pending).toHaveLength(1);
	await tick("wr-filter", ["src/main.ts"]);
	expect(host.pending).toHaveLength(2);
	await host.pending[1]?.settle("after src");
	await tick("wr-filter", [], true);
	expect(host.pending).toHaveLength(3);
	await host.pending[2]?.settle("after truncated");
	await tick("wr-filter", []);
	expect(host.pending).toHaveLength(4);
	await host.pending[3]?.settle("after repo meta");
	expect(results).toEqual(["initial", "after src", "after truncated", "after repo meta"]);
	await view.unmount();
});

test("affectedBy widens the first tick after a reconnect", async () => {
	const host = scriptedReads<string>();
	const results: string[] = [];
	const view = await mount(
		<WorkspaceRead
			workspaceId="wr-reconnect"
			read={host.read}
			results={results}
			affectedBy={(path) => path.startsWith("src/")}
		/>,
	);
	await host.pending[0]?.settle("initial");
	await act(async () => {
		useAppStore.getState().setStatus("disconnected");
		useAppStore.getState().setStatus("connected");
	});
	expect(host.pending).toHaveLength(1);
	await tick("wr-reconnect", ["docs/readme.md"]);
	expect(host.pending).toHaveLength(2);
	await host.pending[1]?.settle("after reconnect");
	await tick("wr-reconnect", ["docs/other.md"]);
	expect(host.pending).toHaveLength(2);
	expect(results).toEqual(["initial", "after reconnect"]);
	await view.unmount();
});

test("affectedBy widens the next tick after a failed read until a read succeeds", async () => {
	const settles: Array<(outcome: "ok" | "fail") => Promise<void>> = [];
	const read = () =>
		new Promise<string>((resolve, reject) => {
			settles.push((outcome) =>
				act(async () => (outcome === "ok" ? resolve("ok") : reject(new Error("refused")))),
			);
		});
	const results: string[] = [];
	const view = await mount(
		<WorkspaceRead
			workspaceId="wr-failed"
			read={read}
			results={results}
			affectedBy={(path) => path.startsWith("src/")}
		/>,
	);
	await settles[0]?.("fail");
	await tick("wr-failed", ["docs/readme.md"]);
	expect(settles).toHaveLength(2);
	await settles[1]?.("ok");
	await tick("wr-failed", ["docs/other.md"]);
	expect(settles).toHaveLength(2);
	expect(results).toEqual(["ok"]);
	await view.unmount();
});

function LiveTab(props: {
	workspaceId: string;
	path: string;
	read: (path: string) => Promise<string>;
	applied: string[];
}) {
	const [loadedTick, setLoadedTick] = useState(0);
	useLiveTabContent(
		{ workspaceId: props.workspaceId, path: props.path, loadedTick },
		{
			read: () => props.read(props.path),
			applyFresh: (fresh, tickNumber) => {
				props.applied.push(fresh);
				setLoadedTick(tickNumber);
			},
			keepCurrent: setLoadedTick,
		},
	);
	return null;
}

test("a slow tab read waits out further ticks, lands, then catches up once", async () => {
	const host = scriptedReads<string>();
	const applied: string[] = [];
	const view = await mount(
		<LiveTab workspaceId="lt-slow" path="f.ts" read={host.read} applied={applied} />,
	);
	expect(host.pending).toHaveLength(0);
	for (let i = 0; i < 3; i += 1) await tick("lt-slow", ["f.ts"]);
	expect(host.keys()).toEqual(["f.ts"]);

	await host.pending[0]?.settle("v1");
	expect(applied).toEqual(["v1"]);
	expect(host.keys()).toEqual(["f.ts", "f.ts"]);
	await host.pending[1]?.settle("v3");
	expect(applied).toEqual(["v1", "v3"]);
	expect(host.pending).toHaveLength(2);
	await view.unmount();
});

test("a tab that moves to another file drops the old file's answer", async () => {
	const host = scriptedReads<string>();
	const applied: string[] = [];
	const props = { workspaceId: "lt-switch", read: host.read, applied };
	const view = await mount(<LiveTab path="a.ts" {...props} />);
	await tick("lt-switch", [], true);
	await view.rerender(<LiveTab path="b.ts" {...props} />);
	expect(host.keys()).toEqual(["a.ts", "b.ts"]);

	await host.pending[0]?.settle("a contents");
	expect(applied).toEqual([]);
	await host.pending[1]?.settle("b contents");
	expect(applied).toEqual(["b contents"]);
	await view.unmount();
});
