import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@thinkrail/contracts";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { selectOrderedProjects, useAppStore } from "../store";
import { initProjectOrderPersistence, parseProjectOrder } from "./projectOrder";

const reset = () => useAppStore.setState(useAppStore.getInitialState(), true);
beforeEach(reset);
afterEach(reset);

const projects: Project[] = ["a", "b", "c"].map((id, index) => ({
	id,
	name: id,
	path: `/projects/${id}`,
	slug: id,
	lastOpened: 300 - index * 100,
}));

function memoryAdapter(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const adapter = {
		getItem: mock((key: string) => values.get(key) ?? null),
		setItem: mock((key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: mock((key: string) => {
			values.delete(key);
		}),
	} satisfies StablePreferenceAdapter;
	return { adapter, values };
}

test.each([
	null,
	"",
	"{bad json",
	"null",
	"false",
	"42",
	'"a"',
	'{"a":1}',
	"[]",
])("invalid or absent stored preference %s parses as an empty order", (raw) => {
	expect(parseProjectOrder(raw)).toEqual([]);
});

test("parsing retains only nonempty string IDs and deduplicates in saved order", () => {
	expect(parseProjectOrder('["c",null,"",3,{},[],false,"a","c","closed","a"]')).toEqual([
		"c",
		"a",
		"closed",
	]);
});

test("the supplied native adapter uses project-order and restores before projects arrive", () => {
	const { adapter } = memoryAdapter({ "project-order": '["c","closed","c","a"]' });
	const unsubscribe = initProjectOrderPersistence(adapter);
	try {
		expect(adapter.getItem).toHaveBeenCalledWith("project-order");
		expect(useAppStore.getState().projectOrder).toEqual(["c", "closed", "a"]);
		expect(selectOrderedProjects(useAppStore.getState())).toEqual([]);
		useAppStore.getState().installProjectSnapshot(projects, projects);
		expect(selectOrderedProjects(useAppStore.getState()).map(({ id }) => id)).toEqual([
			"c",
			"a",
			"b",
		]);
		expect(adapter.setItem).not.toHaveBeenCalled();
	} finally {
		unsubscribe();
	}
});

test.each([
	null,
	"not json",
	'{"order":["a"]}',
])("missing or malformed storage %s clears stale in-memory order on hydration", (raw) => {
	const { adapter } = memoryAdapter(raw === null ? {} : { "project-order": raw });
	useAppStore.getState().hydrateProjectOrder(["c"]);
	const unsubscribe = initProjectOrderPersistence(adapter);
	try {
		expect(useAppStore.getState().projectOrder).toEqual([]);
		expect(adapter.setItem).not.toHaveBeenCalled();
	} finally {
		unsubscribe();
	}
});

test("writes order changes only, stops on unsubscribe, and restores in a fresh store", () => {
	const { adapter, values } = memoryAdapter();
	useAppStore.setState({ projects, recentProjects: projects });
	const unsubscribe = initProjectOrderPersistence(adapter);
	try {
		const store = useAppStore.getState();
		store.moveProject("c", "a", "before");
		expect(adapter.setItem).toHaveBeenCalledTimes(1);
		expect(adapter.setItem).toHaveBeenLastCalledWith("project-order", '["c","a","b"]');
		store.selectProject("a");
		store.installProjectSnapshot(projects, projects);
		store.moveProject("c", "a", "before");
		store.moveProject("missing", "a", "before");
		expect(adapter.setItem).toHaveBeenCalledTimes(1);
	} finally {
		unsubscribe();
	}
	useAppStore.getState().moveProject("b", "c", "before");
	expect(adapter.setItem).toHaveBeenCalledTimes(1);
	expect(values.get("project-order")).toBe('["c","a","b"]');
	reset();
	const restoredUnsubscribe = initProjectOrderPersistence(adapter);
	try {
		useAppStore.getState().installProjectSnapshot(projects, projects);
		expect(selectOrderedProjects(useAppStore.getState()).map(({ id }) => id)).toEqual([
			"c",
			"a",
			"b",
		]);
		expect(adapter.setItem).toHaveBeenCalledTimes(1);
	} finally {
		restoredUnsubscribe();
	}
});

test("a read failure falls back to default order but does not prevent later writes", () => {
	const { adapter, values } = memoryAdapter();
	adapter.getItem.mockImplementation(() => {
		throw new Error("read denied");
	});
	useAppStore.setState({ projects, projectOrder: ["c"] });
	const unsubscribe = initProjectOrderPersistence(adapter);
	try {
		expect(useAppStore.getState().projectOrder).toEqual([]);
		expect(selectOrderedProjects(useAppStore.getState())).toBe(projects);
		useAppStore.getState().moveProject("b", "a", "before");
		expect(values.get("project-order")).toBe('["b","a","c"]');
	} finally {
		unsubscribe();
	}
});

test("a failed write leaves the local move intact and later changes can still persist", () => {
	const { adapter, values } = memoryAdapter({ "project-order": '["c","a","b"]' });
	adapter.setItem.mockImplementationOnce(() => {
		throw new Error("quota exceeded");
	});
	useAppStore.setState({ projects });
	const unsubscribe = initProjectOrderPersistence(adapter);
	try {
		expect(() => useAppStore.getState().moveProject("b", "c", "before")).not.toThrow();
		expect(useAppStore.getState().projectOrder).toEqual(["b", "c", "a"]);
		expect(values.get("project-order")).toBe('["c","a","b"]');
		useAppStore.getState().moveProject("a", "b", "before");
		expect(values.get("project-order")).toBe('["a","b","c"]');
		expect(adapter.setItem).toHaveBeenCalledTimes(2);
	} finally {
		unsubscribe();
	}
});
