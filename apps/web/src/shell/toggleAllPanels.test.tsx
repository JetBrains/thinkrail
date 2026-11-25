import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useAppStore } from "../store";
import { hideAllPanels, toggleAllPanels, toggleBottomPanel, toggleRightSide } from "./chordActions";
import { type LayoutTabFocusRequest, shownAuxiliaryRegions } from "./layout";
import { useLayoutIntentProcessing } from "./layoutIntents";
import {
	applyLayoutAttention,
	commitWorkspaceLayout,
	ensureWorkspaceLayoutState,
	resetLayoutStateForTests,
	setLayoutStateStorageForTests,
} from "./layoutState";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };
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

function headlessContainer(): Element {
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

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

const WORKSPACE = "workspace";

function Processor({ focus }: { focus: LayoutTabFocusRequest[] }) {
	useLayoutIntentProcessing(
		WORKSPACE,
		(document, attention, panelsToRestore) =>
			void commitWorkspaceLayout(WORKSPACE, document, {
				...(attention ? { attention } : {}),
				...(panelsToRestore ? { panelsToRestore } : {}),
			}),
		(next) => applyLayoutAttention(WORKSPACE, next),
		(request) => focus.push(request),
	);
	return null;
}

const shown = () => {
	const document = useAppStore.getState().layoutDocumentsByWorkspace[WORKSPACE];
	if (!document) throw new Error("Missing workspace layout");
	return shownAuxiliaryRegions(document);
};

const remembered = () => useAppStore.getState().panelsToRestore;

async function run(action: () => void): Promise<void> {
	await act(async () => action());
}

let focus: LayoutTabFocusRequest[] = [];
let unmount: () => Promise<void> = async () => {};

beforeEach(async () => {
	resetLayoutStateForTests();
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 1,
		activeWorkspaceId: WORKSPACE,
		removedWorkspaceIds: {},
		workbenchFrame: null,
		workspaceViewsByWorkspace: {},
		layoutStateReady: false,
		localLayoutPreferences: { defaultPresetId: "balanced", maxSideGroups: 6, maxBottomGroups: 3 },
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutProjectionEpoch: 0,
		panelsToRestore: [],
		layoutIntents: [],
		terminalsByWorkspace: {},
		workspaceSelectionHistory: [],
		toasts: [],
	});
	setLayoutStateStorageForTests(
		{ local: new MemoryStorage(), session: new MemoryStorage() },
		"http://host.test",
	);
	await ensureWorkspaceLayoutState(WORKSPACE);
	focus = [];
	const root = createRoot(headlessContainer());
	await act(async () => root.render(<Processor focus={focus} />));
	unmount = () => act(async () => root.unmount());
});

afterEach(async () => {
	await unmount();
	resetLayoutStateForTests();
});

describe("Hide all panels", () => {
	test("hides the shown panes, then brings back exactly those", async () => {
		await run(toggleRightSide);
		expect(shown()).toEqual(["left", "bottom"]);
		focus.length = 0;

		await run(toggleAllPanels);
		expect(shown()).toEqual([]);
		expect(remembered()).toEqual(["left", "bottom"]);
		expect(focus).toHaveLength(1);
		expect(focus[0]).toMatchObject({ location: { area: "center" }, onlyIfFocusLost: true });

		await run(toggleAllPanels);
		expect(shown()).toEqual(["left", "bottom"]);
		expect(remembered()).toEqual([]);
		expect(focus).toHaveLength(1);
		expect(useAppStore.getState().layoutIntents).toEqual([]);
	});

	test("opening a pane by hand clears the memory, so the next press hides what is shown", async () => {
		await run(toggleAllPanels);
		expect(remembered()).toEqual(["left", "right", "bottom"]);

		await run(toggleBottomPanel);
		expect(shown()).toEqual(["bottom"]);
		expect(remembered()).toEqual([]);

		await run(toggleAllPanels);
		expect(shown()).toEqual([]);
		expect(remembered()).toEqual(["bottom"]);

		await run(toggleAllPanels);
		expect(shown()).toEqual(["bottom"]);
	});

	test("the hide half fills the same memory and never restores", async () => {
		await run(() => hideAllPanels(WORKSPACE));
		expect(shown()).toEqual([]);
		expect(remembered()).toEqual(["left", "right", "bottom"]);
		const hidden = useAppStore.getState().layoutDocumentsByWorkspace[WORKSPACE];

		await run(() => hideAllPanels(WORKSPACE));
		expect(useAppStore.getState().layoutDocumentsByWorkspace[WORKSPACE]).toBe(hidden);

		await run(toggleAllPanels);
		expect(shown()).toEqual(["left", "right", "bottom"]);
	});

	test("with nothing shown and nothing remembered, as after a reload, a press shows left and right", async () => {
		await run(toggleAllPanels);
		useAppStore.setState({ panelsToRestore: [] });

		await run(toggleAllPanels);
		expect(shown()).toEqual(["left", "right"]);
	});

	test("without an active workspace the chord action queues nothing", () => {
		useAppStore.setState({ activeWorkspaceId: null });
		toggleAllPanels();
		expect(useAppStore.getState().layoutIntents).toEqual([]);
	});
});
