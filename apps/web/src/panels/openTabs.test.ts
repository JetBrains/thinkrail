import { beforeEach, expect, mock, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";

// The openers talk to the host through the transport singleton, which a unit test has no socket for. The
// stub is a *deferred* request: the test resolves it by hand, which is the only way to observe what the
// store did WHILE a read was in flight — the whole point of these cases.
let pending: { resolve: (value: unknown) => void } | null = null;
const requests: { method: string; params: unknown }[] = [];
// The real barrel is spread back in: `mock.module` replaces the WHOLE module for every importer in the
// process, so returning `getTransport` alone would break any other test file that imports `errorText` from
// here — a failure whose appearance depends on suite file order.
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return new Promise((resolve) => {
				pending = { resolve };
			});
		},
	}),
}));

const { useAppStore } = await import("../store");
const { openDiffInTab } = await import("./openTabs");

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	id: "w1",
	projectId: "p1",
	name: "workspace-1",
	branch: "workspace-1",
	worktreePath: "/wt/w1",
	baseBranch: "main",
	...overrides,
});

beforeEach(() => {
	pending = null;
	requests.length = 0;
	useAppStore.setState({
		workspaces: { p1: [workspace()] },
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		fsChangesByWorkspace: {},
	});
});

const openedDiffTab = () => {
	const tab = (useAppStore.getState().tabsByWorkspace.w1 ?? [])[0];
	if (tab?.kind !== "diff") throw new Error("no diff tab opened");
	return tab;
};

/**
 * The stamps a fresh tab carries (`loadedTick`, `loadedTarget`) are claims about what its contents were read
 * against, and both are read from the store — which keeps moving while the request is in flight. Taken on the
 * way back, they would claim a state the contents never saw, and the live-refresh contract (which re-reads on
 * exactly that drift) would see none: stale content under a new claim, indefinitely.
 */
test("a diff tab is stamped with the target and tick captured BEFORE its read, not after", async () => {
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	expect(requests).toEqual([
		{
			method: "git.diffFile",
			params: { workspaceId: "w1", path: "README.md", scope: { kind: "branch" } },
		},
	]);

	// Mid-read: the review target is re-pointed (a `workspace.setDiffBase` broadcast) and the worktree
	// changes (an `fsChanged` push). Neither is reflected in the response now on its way back.
	useAppStore.getState().updateWorkspace(workspace({ diffBase: "develop" }));
	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["README.md"],
		truncated: false,
		skillChange: "none",
	});

	pending?.resolve({ original: "old", modified: "new" });
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main"); // the target the read was issued against, not "develop"
	expect(tab.loadedTick).toBe(0); // the tick before the push, so `DiffPane` re-reads on mount
});

test("an undisturbed open stamps the state it actually read against", async () => {
	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["other.ts"],
		truncated: false,
		skillChange: "none",
	});
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	pending?.resolve({ original: "old", modified: "new" });
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main");
	expect(tab.loadedTick).toBe(1); // the tick that was already folded when the read left
});
