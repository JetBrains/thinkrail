import { expect, test } from "bun:test";
import { ATTENTION_PROTOCOL_VERSION, SESSION_RUNNING_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsSessionAttention, supportsSessionRunning } from "./wireTransport";

test("session attention is gated on its coordinated protocol version", () => {
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionAttention(null)).toBe(false);
});

test("session running is gated on its additive protocol version", () => {
	expect(supportsSessionRunning(SESSION_RUNNING_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionRunning(SESSION_RUNNING_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionRunning(null)).toBe(false);
});
