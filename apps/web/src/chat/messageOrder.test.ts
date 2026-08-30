import { describe, expect, test } from "bun:test";
import { STORAGE_PREFIX } from "../constants/branding";
import {
	chatMessageOrderStorageKey,
	DEFAULT_CHAT_MESSAGE_ORDER,
	isChatMessageOrder,
	parseChatMessageOrder,
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
});
