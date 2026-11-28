import { afterEach, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { initDiffWrapPersistence } from "./diffWrapPreference";

function memoryAdapter(initial?: string) {
	const values = new Map(initial === undefined ? [] : [["diff-wrap-lines", initial]]);
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: mock((key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: (key: string) => {
			values.delete(key);
		},
	} satisfies StablePreferenceAdapter & { values: Map<string, string> };
}

let stop: (() => void) | undefined;
const initialState = useAppStore.getInitialState();

afterEach(() => {
	stop?.();
	stop = undefined;
	useAppStore.setState(initialState, true);
});

test.each([undefined, "false", "TRUE", "1", "invalid"])(
	"a client with stored value %s keeps wrapping off",
	(value) => {
		useAppStore.getState().setDiffWrapLines(true);
		const adapter = memoryAdapter(value);
		stop = initDiffWrapPersistence(adapter);
		expect(useAppStore.getState().diffWrapLines).toBe(false);
		expect(adapter.setItem).not.toHaveBeenCalled();
	},
);

test("a stored choice survives host configuration and saves later reading changes", () => {
	const adapter = memoryAdapter("true");
	stop = initDiffWrapPersistence(adapter);
	expect(useAppStore.getState().diffWrapLines).toBe(true);
	useAppStore.getState().applyConfig(DEFAULT_CONFIG);
	useAppStore.getState().setMarkdownOutlineVisible(true);
	expect(useAppStore.getState().diffWrapLines).toBe(true);
	expect(adapter.setItem).not.toHaveBeenCalled();

	useAppStore.getState().setDiffWrapLines(false);
	expect(adapter.values.get("diff-wrap-lines")).toBe("false");
	useAppStore.getState().setDiffWrapLines(false);
	expect(adapter.setItem).toHaveBeenCalledTimes(1);
	useAppStore.getState().setDiffWrapLines(true);
	expect(adapter.values.get("diff-wrap-lines")).toBe("true");
	expect(adapter.setItem).toHaveBeenCalledTimes(2);

	stop();
	useAppStore.getState().setDiffWrapLines(false);
	expect(adapter.values.get("diff-wrap-lines")).toBe("true");
});

test("unavailable preference storage does not prevent changing the reading mode", () => {
	const adapter: StablePreferenceAdapter = {
		getItem: () => {
			throw new Error("storage unavailable");
		},
		setItem: () => {
			throw new Error("storage unavailable");
		},
		removeItem: () => {},
	};
	useAppStore.getState().setDiffWrapLines(true);
	stop = initDiffWrapPersistence(adapter);
	expect(useAppStore.getState().diffWrapLines).toBe(false);
	expect(() => useAppStore.getState().setDiffWrapLines(true)).not.toThrow();
	expect(useAppStore.getState().diffWrapLines).toBe(true);
});
