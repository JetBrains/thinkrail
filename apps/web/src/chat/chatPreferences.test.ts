import { describe, expect, test } from "bun:test";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import {
	CHAT_MESSAGE_ORDER_PREFERENCE_KEY,
	chatMessageOrderFromStorageEvent,
	chatMessageOrderStorageKey,
	DEFAULT_CHAT_MESSAGE_ORDER,
	initChatPreferencesPersistence,
	isChatMessageOrder,
	moveStreamingResponseTrigger,
	parseChatMessageOrder,
	parseStreamingResponseMovement,
	STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY,
	type StablePreferenceAdapter,
	streamingResponseMovementFromStorageEvent,
	streamingResponseMovementStorageKey,
} from "./chatPreferences";

describe("streaming response movement preference", () => {
	test("defaults the pin line to 100% and accepts only legal five-point values", () => {
		expect(parseStreamingResponseMovement({ trigger: 95 })).toEqual({ trigger: 95 });
		expect(parseStreamingResponseMovement(null)).toEqual({ trigger: 100 });
		expect(parseStreamingResponseMovement({ trigger: 30 })).toEqual({ trigger: 100 });
		expect(parseStreamingResponseMovement({ trigger: 96 })).toEqual({ trigger: 100 });
		expect(parseStreamingResponseMovement({ trigger: "95" })).toEqual({ trigger: 100 });
	});

	test("a saved value with an extra settle field keeps its pin line", () => {
		expect(parseStreamingResponseMovement({ settle: 65, trigger: 95 })).toEqual({ trigger: 95 });
		expect(parseStreamingResponseMovement({ settle: 90, trigger: 95 })).toEqual({ trigger: 95 });
		expect(parseStreamingResponseMovement({ settle: 66, trigger: 40 })).toEqual({ trigger: 40 });
	});

	test("moving the pin line rounds to five points and clamps to 35–100", () => {
		expect(moveStreamingResponseTrigger({ trigger: 100 }, 63)).toEqual({ trigger: 65 });
		expect(moveStreamingResponseTrigger({ trigger: 100 }, 10)).toEqual({ trigger: 35 });
		expect(moveStreamingResponseTrigger({ trigger: 60 }, 120)).toEqual({ trigger: 100 });
		expect(moveStreamingResponseTrigger({ trigger: 60 }, Number.NaN)).toEqual({ trigger: 60 });
	});

	test("the store exposes the client-local default and an atomic setter", () => {
		const state = useAppStore.getState();
		expect(state.streamingResponseMovement).toEqual({ trigger: 100 });
		state.setStreamingResponseMovement({ trigger: 90 });
		expect(useAppStore.getState().streamingResponseMovement).toEqual({ trigger: 90 });
		useAppStore.getState().setStreamingResponseMovement({ trigger: 100 });
	});

	test("host-qualified storage events synchronize the movement", () => {
		const storage = {} as Storage;
		const key = streamingResponseMovementStorageKey("http://localhost:31415");

		expect(key).toBe(`${STORAGE_PREFIX}streaming-response-movement:http://localhost:31415`);
		expect(
			streamingResponseMovementFromStorageEvent(
				{ key, newValue: '{"trigger":95}', storageArea: storage },
				storage,
				key,
			),
		).toEqual({ trigger: 95 });
		expect(
			streamingResponseMovementFromStorageEvent(
				{ key, newValue: '{"settle":65,"trigger":95}', storageArea: storage },
				storage,
				key,
			),
		).toEqual({ trigger: 95 });
		expect(
			streamingResponseMovementFromStorageEvent(
				{ key, newValue: '{"trigger":96}', storageArea: storage },
				storage,
				key,
			),
		).toEqual({ trigger: 100 });
	});

	test("one injected preference seam hydrates and persists message order plus movement", () => {
		const writes: Array<[string, string]> = [];
		const removals: string[] = [];
		const adapter: StablePreferenceAdapter = {
			getItem: (key) => {
				if (key === CHAT_MESSAGE_ORDER_PREFERENCE_KEY) return "newest-first";
				if (key === STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY) {
					return '{"settle":65,"trigger":95}';
				}
				return null;
			},
			setItem: (key, value) => writes.push([key, value]),
			removeItem: (key) => removals.push(key),
		};
		const dispose = initChatPreferencesPersistence(adapter);
		try {
			expect(useAppStore.getState().chatMessageOrder).toBe("newest-first");
			expect(useAppStore.getState().streamingResponseMovement).toEqual({ trigger: 95 });
			useAppStore.getState().setStreamingResponseMovement({ trigger: 90 });
			expect(writes).toContainEqual([STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY, '{"trigger":90}']);
			useAppStore.getState().setStreamingResponseMovement({ trigger: 100 });
			expect(removals).toContain(STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY);
		} finally {
			dispose();
			useAppStore.getState().setChatMessageOrder(DEFAULT_CHAT_MESSAGE_ORDER);
			useAppStore.getState().setStreamingResponseMovement({ trigger: 100 });
		}
	});
});

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
});
