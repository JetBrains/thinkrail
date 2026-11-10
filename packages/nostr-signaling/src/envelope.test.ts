import { describe, expect, test } from "bun:test";
import { createInOrder, encodeEnvelope, parseEnvelope } from "./envelope";
import { normalizeRelays } from "./relays";

describe("envelope", () => {
	test("round-trips and rejects malformed input", () => {
		expect(parseEnvelope(encodeEnvelope({ seq: 3, data: "x" }))).toEqual({ seq: 3, data: "x" });
		for (const raw of [
			"",
			"null",
			"[]",
			'{"s":-1,"d":"x"}',
			'{"s":1.5,"d":"x"}',
			'{"s":1,"d":""}',
			'{"s":1}',
		]) {
			expect(parseEnvelope(raw)).toBeNull();
		}
		expect(parseEnvelope(encodeEnvelope({ seq: 0, data: "a".repeat(70_000) }))).toBeNull();
	});

	test("delivers each sender's frames in send order, once", () => {
		const out: string[] = [];
		const push = createInOrder((data) => out.push(data));
		push({ seq: 2, data: "c" });
		push({ seq: 1, data: "b" });
		expect(out).toEqual([]);
		push({ seq: 0, data: "a" });
		push({ seq: 1, data: "b" });
		push({ seq: 3, data: "d" });
		expect(out).toEqual(["a", "b", "c", "d"]);
	});
});

describe("normalizeRelays", () => {
	test("keeps distinct wss URLs and loopback ws only", () => {
		expect(
			normalizeRelays([
				"wss://relay.example/",
				"wss://relay.example",
				"ws://relay.example",
				"https://relay.example",
				"not a url",
				"ws://127.0.0.1:7000",
			]),
		).toEqual(["wss://relay.example", "ws://127.0.0.1:7000"]);
	});
});
