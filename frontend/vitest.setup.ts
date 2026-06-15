/**
 * Vitest global setup.
 *
 * jsdom exposes a `localStorage` whose methods aren't usable inside the vitest
 * worker, so zustand's `persist` middleware throws "storage.setItem is not a
 * function" the first time a persisted store writes. Install a simple in-memory
 * Storage whenever a working one is absent (covers both the node and jsdom test
 * environments).
 */
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

if (typeof globalThis.localStorage?.setItem !== "function") {
  installMemoryStorage();
}
