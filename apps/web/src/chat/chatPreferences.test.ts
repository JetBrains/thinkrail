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
	moveStreamingResponseHandle,
	parseChatMessageOrder,
	parseStreamingResponseMovement,
	STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY,
	type StablePreferenceAdapter,
	streamingResponseMovementFromStorageEvent,
	streamingResponseMovementStorageKey,
} from "./chatPreferences";

describe("streaming response movement preference", () => {
	test("defaults to the approved 75%→100% window and accepts only legal five-point pairs", () => {
		expect(parseStreamingResponseMovement({ settle: 65, trigger: 95 })).toEqual({
			settle: 65,
			trigger: 95,
		});
		expect(parseStreamingResponseMovement(null)).toEqual({ settle: 75, trigger: 100 });
		expect(parseStreamingResponseMovement({ settle: 20, trigger: 100 })).toEqual({
			settle: 75,
			trigger: 100,
		});
		expect(parseStreamingResponseMovement({ settle: 75, trigger: 80 })).toEqual({
			settle: 75,
			trigger: 100,
		});
		expect(parseStreamingResponseMovement({ settle: 76, trigger: 100 })).toEqual({
			settle: 75,
			trigger: 100,
		});
	});

	test("moving one handle clamps to its legal range and never pushes the other", () => {
		expect(moveStreamingResponseHandle({ settle: 75, trigger: 100 }, "settle", 95)).toEqual({
			settle: 90,
			trigger: 100,
		});
		expect(moveStreamingResponseHandle({ settle: 55, trigger: 90 }, "trigger", 60)).toEqual({
			settle: 55,
			trigger: 65,
		});
		expect(moveStreamingResponseHandle({ settle: 75, trigger: 100 }, "settle", 63)).toEqual({
			settle: 65,
			trigger: 100,
		});
		expect(moveStreamingResponseHandle({ settle: 75, trigger: 100 }, "settle", Number.NaN)).toEqual(
			{
				settle: 75,
				trigger: 100,
			},
		);
	});

	test("the store exposes the approved client-local default and an atomic setter", () => {
		const state = useAppStore.getState();
		expect(state.streamingResponseMovement).toEqual({ settle: 75, trigger: 100 });
		state.setStreamingResponseMovement({ settle: 60, trigger: 90 });
		expect(useAppStore.getState().streamingResponseMovement).toEqual({
			settle: 60,
			trigger: 90,
		});
		useAppStore.getState().setStreamingResponseMovement({ settle: 75, trigger: 100 });
	});

	test("host-qualified storage events synchronize the complete movement pair atomically", () => {
		const storage = {} as Storage;
		const key = streamingResponseMovementStorageKey("http://localhost:31415");

		expect(key).toBe(`${STORAGE_PREFIX}streaming-response-movement:http://localhost:31415`);
		expect(
			streamingResponseMovementFromStorageEvent(
				{ key, newValue: '{"settle":65,"trigger":95}', storageArea: storage },
				storage,
				key,
			),
		).toEqual({ settle: 65, trigger: 95 });
		expect(
			streamingResponseMovementFromStorageEvent(
				{ key, newValue: '{"settle":66,"trigger":95}', storageArea: storage },
				storage,
				key,
			),
		).toEqual({ settle: 75, trigger: 100 });
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
			expect(useAppStore.getState().streamingResponseMovement).toEqual({
				settle: 65,
				trigger: 95,
			});
			useAppStore.getState().setStreamingResponseMovement({ settle: 60, trigger: 90 });
			expect(writes).toContainEqual([
				STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY,
				'{"settle":60,"trigger":90}',
			]);
			useAppStore.getState().setStreamingResponseMovement({ settle: 75, trigger: 100 });
			expect(removals).toContain(STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY);
		} finally {
			dispose();
			useAppStore.getState().setChatMessageOrder(DEFAULT_CHAT_MESSAGE_ORDER);
			useAppStore.getState().setStreamingResponseMovement({ settle: 75, trigger: 100 });
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
