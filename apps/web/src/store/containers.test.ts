import { beforeEach, expect, test } from "bun:test";
import type { Container } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import { selectContainerOfWorkspace, selectContainers } from "./selectors";

const container = (id: string, workspaceIds: string[], createdAt = 1): Container => ({
	id,
	name: `Container ${id}`,
	workspaceIds,
	createdAt,
	updatedAt: createdAt,
});

beforeEach(() => {
	useAppStore.setState({ containers: {} });
});

test("a container list replaces the held containers whole", () => {
	const store = useAppStore.getState();
	store.installContainers([container("old", ["w0"])]);
	store.installContainers([container("b", ["w2"], 2), container("a", ["w1"], 2)]);
	expect(Object.keys(useAppStore.getState().containers).sort()).toEqual(["a", "b"]);
	expect(selectContainers(useAppStore.getState()).map((held) => held.id)).toEqual(["a", "b"]);
	store.installContainers([]);
	expect(useAppStore.getState().containers).toEqual({});
});

test("pushes upsert a full snapshot by id and remove by id, idempotently", () => {
	const store = useAppStore.getState();
	store.applyContainerUpdated(container("c1", ["w1"]));
	store.applyContainerUpdated(container("c2", ["w3"], 5));
	store.applyContainerUpdated({ ...container("c1", ["w1", "w2"]), name: "Stack" });
	expect(selectContainers(useAppStore.getState())).toEqual([
		{ ...container("c1", ["w1", "w2"]), name: "Stack" },
		container("c2", ["w3"], 5),
	]);
	store.applyContainerRemoved("c1");
	const afterRemoval = useAppStore.getState().containers;
	store.applyContainerRemoved("c1");
	expect(useAppStore.getState().containers).toBe(afterRemoval);
	expect(Object.keys(afterRemoval)).toEqual(["c2"]);
});

test("a workspace's container is the one listing it; a standalone workspace has none", () => {
	useAppStore
		.getState()
		.installContainers([container("c1", ["w1", "w2"]), container("c2", ["w3"])]);
	const state = useAppStore.getState();
	expect(selectContainerOfWorkspace(state, "w2")?.id).toBe("c1");
	expect(selectContainerOfWorkspace(state, "w3")?.id).toBe("c2");
	expect(selectContainerOfWorkspace(state, "w4")).toBeNull();
});
