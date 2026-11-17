import { afterEach, beforeEach, expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { initNeonGlowPersistence } from "./neonPreference";

function memoryAdapter(initial: Record<string, string> = {}): StablePreferenceAdapter & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

let stop: (() => void) | null = null;
const root = { dataset: {} as DOMStringMap };

beforeEach(() => {
	root.dataset = {};
	Object.assign(globalThis, { document: { documentElement: root } });
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "document");
	stop?.();
	stop = null;
	useAppStore.setState({ neonGlow: true });
});

test("the glow is on for an untouched client and stamped on the root before first paint", () => {
	stop = initNeonGlowPersistence(memoryAdapter());
	expect(useAppStore.getState().neonGlow).toBe(true);
	expect(root.dataset.heliosNeon).toBe("true");
});

test("a stored opt-out hydrates the store, and later changes reach the root and storage", () => {
	const adapter = memoryAdapter({ "neon-glow": "false" });
	stop = initNeonGlowPersistence(adapter);
	expect(useAppStore.getState().neonGlow).toBe(false);
	expect(root.dataset.heliosNeon).toBe("false");

	useAppStore.getState().setNeonGlow(true);
	expect(root.dataset.heliosNeon).toBe("true");
	expect(adapter.values.get("neon-glow")).toBe("true");
});
