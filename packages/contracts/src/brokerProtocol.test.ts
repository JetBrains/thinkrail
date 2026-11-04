import { expect, test } from "bun:test";
import { encodeBrokerFrame, parseBrokerMessage, parseClientMessage } from "./brokerProtocol";

test("parseClientMessage accepts valid client frames", () => {
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
	expect(parseClientMessage(JSON.stringify({ t: "close" }))).toEqual({ t: "close" });
	expect(parseClientMessage(JSON.stringify({ t: "prove", signature: "sig" }))).toEqual({
		t: "prove",
		signature: "sig",
	});
});

test("parseBrokerMessage accepts valid broker frames", () => {
	expect(parseBrokerMessage(JSON.stringify({ t: "open", session: "S1" }))).toEqual({
		t: "open",
		session: "S1",
	});
	expect(parseBrokerMessage(JSON.stringify({ t: "ready" }))).toEqual({ t: "ready" });
	expect(parseBrokerMessage(JSON.stringify({ t: "challenge", nonce: "n" }))).toEqual({
		t: "challenge",
		nonce: "n",
	});
	expect(parseBrokerMessage(JSON.stringify({ t: "registered" }))).toEqual({ t: "registered" });
	const ice = [{ urls: ["turn:turn.example:3478"], username: "u", credential: "c" }];
	expect(parseBrokerMessage(JSON.stringify({ t: "ready", ice }))).toEqual({ t: "ready", ice });

	expect(parseBrokerMessage(JSON.stringify({ t: "frame", data: "d" }))).toEqual({
		t: "frame",
		data: "d",
	});
	expect(parseBrokerMessage(JSON.stringify({ t: "error", reason: "no host" }))).toEqual({
		t: "error",
		reason: "no host",
	});
});

test("both parsers reject bad json, unknown types, missing fields, and oversized payloads", () => {
	expect(parseClientMessage("not json")).toBeNull();
	expect(parseClientMessage(JSON.stringify({ t: "register" }))).toBeNull();
	expect(
		parseClientMessage(JSON.stringify({ t: "frame", data: "x".repeat(256 * 1024 + 1) })),
	).toBeNull();
	expect(parseBrokerMessage(JSON.stringify({ t: "open" }))).toBeNull();
	expect(parseBrokerMessage(JSON.stringify({ t: "nope" }))).toBeNull();
	expect(
		parseBrokerMessage(JSON.stringify({ t: "ready", ice: [{ urls: ["http://x"] }] })),
	).toBeNull();
	expect(parseBrokerMessage(JSON.stringify({ t: "ready", ice: "nope" }))).toBeNull();
});

test("encodeBrokerFrame round-trips", () => {
	expect(JSON.parse(encodeBrokerFrame({ t: "open", session: "S1" }))).toEqual({
		t: "open",
		session: "S1",
	});
});
