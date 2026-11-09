import { expect, test } from "bun:test";
import { createHostRegistry, type KeyValueStore, type SavedHost } from "./hostRegistry";

function memoryStore(): KeyValueStore {
	const map = new Map<string, string>();
	return {
		read: (key) => map.get(key) ?? null,
		write: (key, value) => void map.set(key, value),
	};
}

const host = (over: Partial<SavedHost> = {}): SavedHost => ({
	hostKey: "K1",
	relayUrl: "ws://relay:1",
	label: "Laptop",
	pairedAt: 1,
	...over,
});

test("empty by default; add then list round-trips and persists", () => {
	const store = memoryStore();
	expect(createHostRegistry(store).list()).toEqual([]);
	createHostRegistry(store).add(host());
	expect(createHostRegistry(store).list()).toEqual([host()]); // a fresh registry reads the same store
});

test("adding the same host key replaces the prior entry", () => {
	const registry = createHostRegistry(memoryStore());
	registry.add(host());
	registry.add(host({ label: "Laptop (renamed)", pairedAt: 2 }));
	const list = registry.list();
	expect(list).toHaveLength(1);
	expect(list[0]?.label).toBe("Laptop (renamed)");
});

test("tracks several hosts and removes by key", () => {
	const registry = createHostRegistry(memoryStore());
	registry.add(host());
	registry.add(host({ hostKey: "K2", label: "Server" }));
	expect(registry.list().map((h) => h.hostKey)).toEqual(["K1", "K2"]);
	registry.remove("K1");
	expect(registry.list().map((h) => h.hostKey)).toEqual(["K2"]);
});

test("corrupt storage reads as empty", () => {
	const store = memoryStore();
	store.write("thinkrail.remote.hosts", "not json");
	expect(createHostRegistry(store).list()).toEqual([]);
});
