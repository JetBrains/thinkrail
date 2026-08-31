import { describe, expect, test } from "bun:test";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import {
	CHAT_MESSAGE_ORDER_PREFERENCE_KEY,
	chatMessageOrderFromStorageEvent,
	chatMessageOrderStorageKey,
	DEFAULT_CHAT_MESSAGE_ORDER,
	initChatMessageOrderPersistence,
	isChatMessageOrder,
	parseChatMessageOrder,
	type StablePreferenceAdapter,
} from "./messageOrder";

describe("chat message order preference", () => {
	test("oldest-first is the compatibility default for missing and invalid values", () => {
		expect(DEFAULT_CHAT_MESSAGE_ORDER).toBe("oldest-first");
		expect(parseChatMessageOrder(null)).toBe("oldest-first");
		expect(parseChatMessageOrder("inside-out")).toBe("oldest-first");
	});

	test("the closed values survive untrusted local persistence reads", () => {
		expect(isChatMessageOrder("oldest-first")).toBe(true);
		expect(isChatMessageOrder("newest-first")).toBe(true);
		expect(parseChatMessageOrder("newest-first")).toBe("newest-first");
	});

	test("storage keys isolate the preference by host endpoint", () => {
		expect(chatMessageOrderStorageKey("http://localhost:31415")).toBe(
			`${STORAGE_PREFIX}chat-message-order:http://localhost:31415`,
		);
		expect(chatMessageOrderStorageKey("http://localhost:31415")).not.toBe(
			chatMessageOrderStorageKey("https://remote.example"),
		);
	});

	test("same-storage events synchronize the host-qualified preference", () => {
		const storage = {} as Storage;
		const key = chatMessageOrderStorageKey("http://localhost:31415");
		expect(
			chatMessageOrderFromStorageEvent(
				{ key, newValue: "newest-first", storageArea: storage },
				storage,
				key,
			),
		).toBe("newest-first");
		expect(
			chatMessageOrderFromStorageEvent(
				{ key: `${key}:other`, newValue: "newest-first", storageArea: storage },
				storage,
				key,
			),
		).toBeUndefined();
		expect(
			chatMessageOrderFromStorageEvent(
				{ key, newValue: "newest-first", storageArea: {} as Storage },
				storage,
				key,
			),
		).toBeUndefined();
	});

	test("StorageEvent key=null resets the preference after localStorage.clear", () => {
		const storage = {} as Storage;
		expect(
			chatMessageOrderFromStorageEvent(
				{ key: null, newValue: null, storageArea: storage },
				storage,
				chatMessageOrderStorageKey("http://localhost:31415"),
			),
		).toBe("oldest-first");
	});

	test("an injected stable adapter hydrates synchronously and persists writes and removals", () => {
		const writes: Array<[string, string]> = [];
		const removals: string[] = [];
		const adapter: StablePreferenceAdapter = {
			getItem: (key) => (key === CHAT_MESSAGE_ORDER_PREFERENCE_KEY ? "newest-first" : null),
			setItem: (key, value) => writes.push([key, value]),
			removeItem: (key) => removals.push(key),
		};
		const dispose = initChatMessageOrderPersistence(adapter);
		try {
			expect(useAppStore.getState().chatMessageOrder).toBe("newest-first");
			useAppStore.getState().setChatMessageOrder("oldest-first");
			expect(removals).toEqual([CHAT_MESSAGE_ORDER_PREFERENCE_KEY]);
			useAppStore.getState().setChatMessageOrder("newest-first");
			expect(writes).toEqual([[CHAT_MESSAGE_ORDER_PREFERENCE_KEY, "newest-first"]]);
		} finally {
			dispose();
			useAppStore.getState().setChatMessageOrder(DEFAULT_CHAT_MESSAGE_ORDER);
		}
	});
});
