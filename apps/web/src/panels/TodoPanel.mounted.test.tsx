import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";

function installGlobal(name: string, value: unknown): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	};
}

test("the mounted TODO selectors keep target snapshots stable and ignore stale runtime glance", async () => {
	const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
	const restoreGlobals = [
		installGlobal("window", parsed.window),
		installGlobal("document", parsed.document),
		installGlobal("navigator", parsed.window.navigator),
		installGlobal("Node", parsed.window.Node),
		installGlobal("Element", parsed.window.Element),
		installGlobal("HTMLElement", parsed.window.HTMLElement),
		installGlobal("MutationObserver", parsed.window.MutationObserver),
		installGlobal("IS_REACT_ACT_ENVIRONMENT", true),
	];
	const originalConsoleError = console.error;
	const errors: unknown[][] = [];
	console.error = (...args: unknown[]) => errors.push(args);
	let root: import("react-dom/client").Root | null = null;
	try {
		const [{ createRoot }, { EMPTY_RUNTIME, useAppStore }, todoPanel] = await Promise.all([
			import("react-dom/client"),
			import("../store"),
			import("./TodoPanel"),
		]);
		useAppStore.setState({
			status: "connected",
			connectionGeneration: 5,
			activeWorkspaceId: "workspace-1",
			removedWorkspaceIds: {},
			layoutAttentionByWorkspace: {
				"workspace-1": {
					selectedByGroup: {},
					lastFocusedCenterGroupId: "center",
					lastFocusedSideGroupId: {},
					navigationClockByGroup: {},
					lastFocusedChatSessionId: "session-1",
				},
			},
			tabsByWorkspace: {
				"workspace-1": [
					{
						kind: "chat",
						id: "chat-1",
						workspaceId: "workspace-1",
						name: "Checkout flow",
						sessionId: "session-1",
					},
				],
			},
			closedChatsByWorkspace: {},
			deletedSessionsByWorkspace: {},
			sessionMembershipGenerationByWorkspace: { "workspace-1": 5 },
			sessions: {
				"session-1": {
					...EMPTY_RUNTIME,
					isStreaming: true,
					syncedConnectionGeneration: 4,
				},
			},
		});

		function Probe() {
			const target = todoPanel.useTodoPanelTarget();
			const glance = todoPanel.useTodoPanelGlance(target?.sessionId ?? "");
			return <div data-title={target?.title} data-glance={glance} />;
		}

		const container = parsed.document.getElementById("root");
		if (!container) throw new Error("missing test root");
		root = createRoot(container);
		await act(async () => root?.render(<Probe />));
		expect(container.firstElementChild?.getAttribute("data-title")).toBe("Checkout flow");
		expect(container.firstElementChild?.getAttribute("data-glance")).toBe("waiting");

		await act(async () => {
			const state = useAppStore.getState();
			const runtime = state.sessions["session-1"];
			if (!runtime) throw new Error("missing test runtime");
			useAppStore.setState({
				sessions: {
					...state.sessions,
					"session-1": { ...runtime, syncedConnectionGeneration: 5 },
				},
			});
		});
		expect(container.firstElementChild?.getAttribute("data-glance")).toBe("working");

		await act(async () => {
			useAppStore.setState((state) => ({ templatesVersion: state.templatesVersion + 1 }));
		});
		expect(errors.flat().join(" ")).not.toMatch(/getSnapshot|Maximum update depth/i);
	} finally {
		if (root) await act(async () => root?.unmount());
		console.error = originalConsoleError;
		for (const restore of restoreGlobals.reverse()) restore();
	}
});
