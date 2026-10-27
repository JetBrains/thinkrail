import { afterEach, beforeEach, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type Project } from "@thinkrail/contracts";
import { selectOrderedProjects, useAppStore } from "./index";

const reset = () => useAppStore.setState(useAppStore.getInitialState(), true);
beforeEach(reset);
afterEach(reset);

function project(id: string, lastOpened = 0): Project {
	return { id, name: id, path: `/projects/${id}`, slug: id, lastOpened };
}

const projects = [project("a", 300), project("b", 200), project("c", 100)];
const orderedIds = () => selectOrderedProjects(useAppStore.getState()).map(({ id }) => id);

test("without a preference the selector returns the original project array and order", () => {
	expect(selectOrderedProjects({ projects, projectOrder: [] })).toBe(projects);
});

test("new unranked projects lead and preserve the saved projects' relative order", () => {
	const state = { projects, projectOrder: ["c", "b"] };
	expect(selectOrderedProjects(state)).toEqual([projects[0], projects[2], projects[1]]);
	expect(state.projects).toBe(projects);
	expect(state.projectOrder).toEqual(["c", "b"]);
});

test("unknown and duplicate saved IDs do not create or duplicate rows", () => {
	expect(
		selectOrderedProjects({ projects, projectOrder: ["closed", "b", "b", "missing"] }),
	).toEqual([projects[0], projects[2], projects[1]]);
	expect(selectOrderedProjects({ projects: [], projectOrder: ["closed"] })).toEqual([]);
});

test("hydration deduplicates without discarding closed IDs or retaining the input array", () => {
	const saved = ["closed", "c", "c", "a", "closed"];
	useAppStore.getState().hydrateProjectOrder(saved);
	expect(useAppStore.getState().projectOrder).toEqual(["closed", "c", "a"]);
	saved.push("b");
	expect(useAppStore.getState().projectOrder).toEqual(["closed", "c", "a"]);
});

test.each([
	["c", "a", "before", ["c", "a", "b"]],
	["a", "c", "before", ["b", "a", "c"]],
	["a", "c", "after", ["b", "c", "a"]],
	["c", "a", "after", ["a", "c", "b"]],
] as const)("moves %s %s with placement %s", (id, targetId, placement, expected) => {
	useAppStore.setState({ projects });
	useAppStore.getState().moveProject(id, targetId, placement);
	expect(orderedIds()).toEqual([...expected]);
	expect(useAppStore.getState().projectOrder).toEqual([...expected]);
	expect(useAppStore.getState().projects).toBe(projects);
});

test.each([
	["missing", "a", "before"],
	["a", "missing", "after"],
	["closed", "a", "before"],
	["a", "closed", "after"],
	["a", "a", "before"],
	["b", "b", "after"],
	["a", "b", "before"],
	["b", "a", "after"],
] as const)("invalid, self and adjacent moves are identity no-ops: %s %s %s", (id, targetId, placement) => {
	useAppStore.setState({ projects, projectOrder: ["a", "closed", "b", "c"] });
	const before = useAppStore.getState();
	before.moveProject(id, targetId, placement);
	expect(useAppStore.getState()).toBe(before);
});

test("an adjacent move does not create a preference when none was saved", () => {
	useAppStore.setState({ projects });
	const before = useAppStore.getState();
	before.moveProject("a", "b", "before");
	expect(useAppStore.getState()).toBe(before);
	expect(useAppStore.getState().projectOrder).toEqual([]);
});

test("moving uses the displayed saved order and changes no recents, navigation or expansion", () => {
	useAppStore.setState({
		projects,
		recentProjects: [...projects, { ...project("closed"), closed: true }],
		projectOrder: ["c", "a", "b"],
		selectedProjectId: "b",
		activeWorkspaceId: "workspace-b",
		workspaceSelectionHistory: ["workspace-b", "workspace-a"],
		expandedProjectIds: { a: true, b: true },
	});
	const before = useAppStore.getState();
	before.moveProject("b", "c", "after");
	const after = useAppStore.getState();
	expect(orderedIds()).toEqual(["c", "b", "a"]);
	expect(after).toEqual({ ...before, projectOrder: ["c", "b", "a"] });
	expect(after.recentProjects).toBe(before.recentProjects);
	expect(after.workspaceSelectionHistory).toBe(before.workspaceSelectionHistory);
	expect(after.expandedProjectIds).toBe(before.expandedProjectIds);
});

test("welcome, project snapshots and rename/activity updates preserve manual order", () => {
	const store = useAppStore.getState();
	store.hydrateProjectOrder(["c", "a", "b"]);
	const preference = useAppStore.getState().projectOrder;
	store.installWelcomeSnapshot(PROTOCOL_VERSION, projects, projects);
	expect(orderedIds()).toEqual(["c", "a", "b"]);
	expect(useAppStore.getState().projectOrder).toBe(preference);
	store.installProjectSnapshot([...projects].reverse(), projects);
	expect(orderedIds()).toEqual(["c", "a", "b"]);
	expect(useAppStore.getState().projectOrder).toBe(preference);
	const updated = { ...project("b", 500), name: "Renamed" };
	store.applyProjectUpdated(updated);
	expect(orderedIds()).toEqual(["c", "a", "b"]);
	expect(useAppStore.getState().projectOrder).toBe(preference);
	expect(useAppStore.getState().recentProjects.map(({ id }) => id)).toEqual(["b", "a", "c"]);
	expect(selectOrderedProjects(useAppStore.getState())[2]).toEqual(updated);
	store.applyProjectUpdated(project("new", 600));
	expect(orderedIds()).toEqual(["new", "c", "a", "b"]);
	store.applyProjectUpdated(project("newer", 700));
	expect(orderedIds()).toEqual(["newer", "new", "c", "a", "b"]);
	store.moveProject("newer", "a", "after");
	expect(orderedIds()).toEqual(["new", "c", "a", "newer", "b"]);
	store.installProjectSnapshot(
		useAppStore.getState().projects,
		useAppStore.getState().recentProjects,
	);
	expect(orderedIds()).toEqual(["new", "c", "a", "newer", "b"]);
});

test("closing and reopening restores a project's saved rank", () => {
	useAppStore.setState({ projects });
	const store = useAppStore.getState();
	store.moveProject("b", "a", "before");
	const preference = useAppStore.getState().projectOrder;
	store.applyProjectUpdated({ ...project("b", 200), closed: true });
	expect(orderedIds()).toEqual(["a", "c"]);
	expect(useAppStore.getState().projectOrder).toBe(preference);
	store.applyProjectUpdated({ ...project("b", 900), closed: false });
	expect(orderedIds()).toEqual(["b", "a", "c"]);
	expect(useAppStore.getState().projectOrder).toBe(preference);
});

test("reordering open projects preserves closed slots for subsequent reopen", () => {
	useAppStore.setState({ projects, projectOrder: ["a", "b", "c", "closed"] });
	const store = useAppStore.getState();
	store.applyProjectUpdated({ ...project("b", 200), closed: true });
	store.applyProjectUpdated(project("new", 400));
	store.moveProject("c", "a", "before");
	expect(useAppStore.getState().projectOrder).toEqual(["new", "b", "c", "closed", "a"]);
	expect(orderedIds()).toEqual(["new", "c", "a"]);
	store.applyProjectUpdated({ ...project("b", 900), closed: false });
	store.applyProjectUpdated({ ...project("closed", 1000), closed: false });
	expect(orderedIds()).toEqual(["new", "b", "c", "closed", "a"]);
});
