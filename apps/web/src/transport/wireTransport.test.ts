import { expect, test } from "bun:test";
import {
	ATTENTION_NAVIGATION_PROTOCOL_VERSION,
	ATTENTION_PROTOCOL_VERSION,
	SESSION_RUNNING_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import {
	supportsAttentionNavigation,
	supportsSessionAttention,
	supportsSessionRunning,
} from "./wireTransport";

test("session attention is gated on its coordinated protocol version", () => {
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionAttention(null)).toBe(false);
});

test("attention navigation requires priority and recency metadata", () => {
	expect(supportsAttentionNavigation(ATTENTION_NAVIGATION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsAttentionNavigation(ATTENTION_NAVIGATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsAttentionNavigation(null)).toBe(false);
});

test("session running is gated on its additive protocol version", () => {
	expect(supportsSessionRunning(SESSION_RUNNING_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionRunning(SESSION_RUNNING_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionRunning(null)).toBe(false);
});
