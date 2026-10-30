import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { createPaletteNavigator } from "./paletteNavigation";

const project = (id: string): Project => ({
	id,
	name: id,
	path: `/repos/${id}`,
	slug: id,
	lastOpened: 0,
});

const workspace = (id: string, projectId: string): Workspace => ({
	id,
	projectId,
	name: id,
	branch: id,
	baseBranch: "main",
	worktreePath: `/worktrees/${id}`,
});

const initial = useAppStore.getInitialState();

beforeEach(() => useAppStore.setState(initial, true));
afterEach(() => useAppStore.setState(initial, true));

function deferredLoader() {
	const pending = new Map<string, () => void>();
	const load = (projectId: string) =>
		new Promise<void>((resolve) => {
			pending.set(projectId, () => {
				useAppStore.getState().setWorkspaces(projectId, [workspace(`${projectId}-w`, projectId)]);
				resolve();
			});
		});
	return { load, finish: (projectId: string) => pending.get(projectId)?.() };
}

describe("palette navigation", () => {
	test("of two picks still loading, only the later one opens, whichever list lands first", async () => {
		useAppStore.setState({ projects: [project("pa"), project("pb")] });
		const loader = deferredLoader();
		const navigator = createPaletteNavigator(loader.load);
		const first = navigator.navigateToWorkspace({ id: "pa-w", projectId: "pa" });
		const second = navigator.navigateToWorkspace({ id: "pb-w", projectId: "pb" });
		loader.finish("pa");
		expect(await first).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBeNull();
		loader.finish("pb");
		expect(await second).toBe(true);
		expect(useAppStore.getState().activeWorkspaceId).toBe("pb-w");
	});

	test("a begun pick stops being wanted after a later pick or a navigation elsewhere, not when its own list lands", () => {
		useAppStore.setState({
			projects: [project("pa"), project("pb")],
			workspaces: { pb: [workspace("pb-w", "pb")] },
		});
		const navigator = createPaletteNavigator(deferredLoader().load);
		const overtaken = navigator.beginPick();
		const current = navigator.beginPick();
		expect(overtaken()).toBe(false);
		expect(current()).toBe(true);
		useAppStore.getState().setWorkspaces("pa", [workspace("pa-default", "pa")]);
		expect(current()).toBe(true);
		useAppStore.getState().activateWorkspace({ id: "pb-w", projectId: "pb" });
		expect(current()).toBe(false);
	});

	test("a workspace the store already holds opens at once", async () => {
		useAppStore.setState({
			projects: [project("p1")],
			workspaces: { p1: [workspace("w1", "p1")] },
		});
		const loader = deferredLoader();
		const navigator = createPaletteNavigator(loader.load);
		expect(await navigator.navigateToWorkspace({ id: "w1", projectId: "p1" })).toBe(true);
		expect(useAppStore.getState().activeWorkspaceId).toBe("w1");
	});

	test("an unloaded workspace opens once its project's list lands", async () => {
		useAppStore.setState({ projects: [project("p1")] });
		const loader = deferredLoader();
		const navigator = createPaletteNavigator(loader.load);
		const opened = navigator.navigateToWorkspace({ id: "p1-w", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceId).toBeNull();
		loader.finish("p1");
		expect(await opened).toBe(true);
		expect(useAppStore.getState().activeWorkspaceId).toBe("p1-w");
	});

	test("a later pick or a navigation elsewhere wins over a pick still loading its project, a tab opening on its own does not", async () => {
		useAppStore.setState({
			projects: [project("p1"), project("p2")],
			workspaces: { p2: [workspace("w2", "p2")] },
		});
		const loader = deferredLoader();
		const navigator = createPaletteNavigator(loader.load);
		const stale = navigator.navigateToWorkspace({ id: "p1-w", projectId: "p1" });
		expect(await navigator.navigateToWorkspace({ id: "w2", projectId: "p2" })).toBe(true);
		loader.finish("p1");
		expect(await stale).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBe("w2");

		const late = navigator.navigateToWorkspace({ id: "p1-tab-w", projectId: "p1-tab" });
		useAppStore.setState((state) => ({
			activeTabByWorkspace: { ...state.activeTabByWorkspace, w2: "a-chat-tab-that-just-opened" },
		}));
		loader.finish("p1-tab");
		expect(await late).toBe(true);
		expect(useAppStore.getState().activeWorkspaceId).toBe("p1-tab-w");

		useAppStore.getState().activateWorkspaceFromRoute({ id: "w2", projectId: "p2" });
		const switched = navigator.navigateToWorkspace({ id: "p1-switch-w", projectId: "p1-switch" });
		useAppStore.getState().noteNavigation("w2");
		loader.finish("p1-switch");
		expect(await switched).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBe("w2");

		const again = navigator.navigateToWorkspace({ id: "p1-later-w", projectId: "p1-later" });
		useAppStore.getState().activateWorkspaceFromRoute({ id: "w2", projectId: "p2" });
		useAppStore.setState({ selectedProjectId: "p2", activeWorkspaceId: null });
		loader.finish("p1-later");
		expect(await again).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBeNull();
	});

	test("a workspace its project's list no longer holds does not open, and the user is told why", async () => {
		useAppStore.setState({ projects: [project("p1")] });
		const loader = deferredLoader();
		const navigator = createPaletteNavigator(loader.load);
		const gone = navigator.navigateToWorkspace({ id: "p1-removed", projectId: "p1" });
		loader.finish("p1");
		expect(await gone).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBeNull();
		expect(useAppStore.getState().toasts.at(-1)?.message).toBe(
			"This result is no longer available",
		);

		const failing = createPaletteNavigator(() => Promise.reject(new Error("socket closed")));
		expect(await failing.navigateToWorkspace({ id: "p2-w", projectId: "p2" })).toBe(false);
		expect(useAppStore.getState().activeWorkspaceId).toBeNull();
		expect(useAppStore.getState().toasts.at(-1)?.message).toBe("socket closed");
	});
});
