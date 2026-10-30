import { expect, test } from "bun:test";
import { encode, parseClientMessage } from "./brokerProtocol";

test("parses every valid client frame", () => {
	expect(parseClientMessage(JSON.stringify({ t: "register", hostKey: "K" }))).toEqual({
		t: "register",
		hostKey: "K",
	});
	expect(parseClientMessage(JSON.stringify({ t: "connect", hostKey: "K" }))).toEqual({
		t: "connect",
		hostKey: "K",
	});
	expect(parseClientMessage(JSON.stringify({ t: "frame", data: "d", session: "S1" }))).toEqual({
		t: "frame",
		data: "d",
		session: "S1",
	});
	expect(parseClientMessage(JSON.stringify({ t: "frame", data: "d" }))).toEqual({
		t: "frame",
		data: "d",
	});
	expect(parseClientMessage(JSON.stringify({ t: "close" }))).toEqual({ t: "close" });
});

test("rejects bad json, unknown types, missing fields, and oversized payloads", () => {
	expect(parseClientMessage("not json")).toBeNull();
	expect(parseClientMessage("null")).toBeNull();
	expect(parseClientMessage(JSON.stringify({ t: "nope" }))).toBeNull();
	expect(parseClientMessage(JSON.stringify({ t: "register" }))).toBeNull();
	expect(
		parseClientMessage(JSON.stringify({ t: "frame", data: "x".repeat(256 * 1024 + 1) })),
	).toBeNull();
});

test("encode round-trips", () => {
	expect(JSON.parse(encode({ t: "open", session: "S1" }))).toEqual({ t: "open", session: "S1" });
});
