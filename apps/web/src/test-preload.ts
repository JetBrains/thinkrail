/**
 * Test preload: pin the interface locale to English.
 *
 * Component tests assert the copy a user sees, and the English string *is* the message key — the
 * catalog only overlays it. Pinning `en` keeps those assertions reading the source copy instead of a
 * translation, so a wording change in the catalog never rewrites a behavioural test, while the
 * translation itself stays guarded by `i18n:check` (which fails below 100% coverage).
 */
const store = new Map<string, string>([["thinkrail.locale", "en"]]);

Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	} satisfies Storage,
});
