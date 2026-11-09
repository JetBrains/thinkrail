import { expect, test } from "bun:test";
import {
	type DeviceMessage,
	encodeDeviceMessage,
	encodeHostMessage,
	type HostMessage,
	parseDeviceMessage,
	parseHostMessage,
} from "./signalingProtocol";

test("parseDeviceMessage accepts valid device frames and trims the label", () => {
	expect(
		parseDeviceMessage(
			JSON.stringify({
				kind: "hello",
				tokenId: "t",
				devicePublicKey: "k",
				label: "  Phone  ",
				nonce: "n",
			}),
		),
	).toEqual({ kind: "hello", tokenId: "t", devicePublicKey: "k", label: "Phone", nonce: "n" });
	expect(
		parseDeviceMessage(JSON.stringify({ kind: "resume", devicePublicKey: "k", nonce: "n" })),
	).toEqual({ kind: "resume", devicePublicKey: "k", nonce: "n" });
	expect(parseDeviceMessage(JSON.stringify({ kind: "proof", signature: "s", mac: "m" }))).toEqual({
		kind: "proof",
		signature: "s",
		mac: "m",
	});
	expect(parseDeviceMessage(JSON.stringify({ kind: "answer", sdp: "s", signature: "g" }))).toEqual({
		kind: "answer",
		sdp: "s",
		signature: "g",
	});
	expect(parseDeviceMessage(JSON.stringify({ kind: "bye" }))).toEqual({ kind: "bye" });
});

test("parseHostMessage accepts valid host frames", () => {
	expect(parseHostMessage(JSON.stringify({ kind: "challenge", challenge: "c" }))).toEqual({
		kind: "challenge",
		challenge: "c",
	});
	expect(parseHostMessage(JSON.stringify({ kind: "accepted" }))).toEqual({ kind: "accepted" });
	expect(parseHostMessage(JSON.stringify({ kind: "offer", sdp: "o", signature: "g" }))).toEqual({
		kind: "offer",
		sdp: "o",
		signature: "g",
	});
	expect(parseHostMessage(JSON.stringify({ kind: "rejected", reason: "no" }))).toEqual({
		kind: "rejected",
		reason: "no",
	});
});

test("a rejection keeps a known code and drops one it does not know", () => {
	expect(
		parseHostMessage(JSON.stringify({ kind: "rejected", reason: "old", code: "outdated_app" })),
	).toEqual({ kind: "rejected", reason: "old", code: "outdated_app" });
	expect(
		parseHostMessage(JSON.stringify({ kind: "rejected", reason: "new", code: "from_the_future" })),
	).toEqual({ kind: "rejected", reason: "new" });
});

test("both parsers reject bad json, unknown kinds, missing fields, unsigned SDP, and empty labels", () => {
	expect(parseDeviceMessage("not json")).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "proof" }))).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "answer", sdp: "s" }))).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "resume", devicePublicKey: "k" }))).toBeNull();
	expect(
		parseDeviceMessage(
			JSON.stringify({
				kind: "hello",
				tokenId: "t",
				devicePublicKey: "k",
				label: "  ",
				nonce: "n",
			}),
		),
	).toBeNull();
	expect(parseHostMessage(JSON.stringify({ kind: "challenge" }))).toBeNull();
	expect(parseHostMessage(JSON.stringify({ kind: "offer", sdp: "o" }))).toBeNull();
	expect(parseHostMessage(JSON.stringify({ kind: "nope" }))).toBeNull();
});

test("encoders round-trip", () => {
	const host: HostMessage = { kind: "challenge", challenge: "c" };
	const device: DeviceMessage = { kind: "proof", signature: "s" };
	expect(JSON.parse(encodeHostMessage(host))).toEqual(host);
	expect(JSON.parse(encodeDeviceMessage(device))).toEqual(device);
});
