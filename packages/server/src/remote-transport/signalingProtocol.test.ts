import { expect, test } from "bun:test";
import { encodeHostMessage, type HostMessage, parseDeviceMessage } from "./signalingProtocol";

test("parses every valid device frame", () => {
	expect(
		parseDeviceMessage(
			JSON.stringify({ kind: "hello", token: "t", devicePublicKey: "k", label: "Phone" }),
		),
	).toEqual({ kind: "hello", token: "t", devicePublicKey: "k", label: "Phone" });
	expect(parseDeviceMessage(JSON.stringify({ kind: "proof", signature: "s" }))).toEqual({
		kind: "proof",
		signature: "s",
	});
	expect(parseDeviceMessage(JSON.stringify({ kind: "candidate", candidate: "c" }))).toEqual({
		kind: "candidate",
		candidate: "c",
	});
	expect(parseDeviceMessage(JSON.stringify({ kind: "bye" }))).toEqual({ kind: "bye" });
});

test("trims and bounds the label", () => {
	const long = "x".repeat(200);
	const parsed = parseDeviceMessage(
		JSON.stringify({ kind: "hello", token: "t", devicePublicKey: "k", label: `  ${long}  ` }),
	);
	expect(parsed?.kind).toBe("hello");
	expect(parsed?.kind === "hello" && parsed.label.length).toBe(64);
});

test("rejects bad json, unknown kinds, missing fields, and empty label", () => {
	expect(parseDeviceMessage("not json")).toBeNull();
	expect(parseDeviceMessage("null")).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "nope" }))).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "proof" }))).toBeNull();
	expect(
		parseDeviceMessage(
			JSON.stringify({ kind: "hello", token: "t", devicePublicKey: "k", label: "   " }),
		),
	).toBeNull();
});

test("encodeHostMessage round-trips", () => {
	const message: HostMessage = { kind: "rejected", reason: "nope" };
	expect(JSON.parse(encodeHostMessage(message))).toEqual(message);
});
