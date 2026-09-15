import { expect, test } from "bun:test";
import { ATTENTION_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsSessionAttention } from "./wireTransport";

test("session attention is gated on its coordinated protocol version", () => {
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionAttention(ATTENTION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionAttention(null)).toBe(false);
});
