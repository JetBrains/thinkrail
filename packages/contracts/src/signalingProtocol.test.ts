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
			JSON.stringify({ kind: "hello", token: "t", devicePublicKey: "k", label: "  Phone  " }),
		),
	).toEqual({ kind: "hello", token: "t", devicePublicKey: "k", label: "Phone" });
	expect(parseDeviceMessage(JSON.stringify({ kind: "answer", sdp: "s" }))).toEqual({
		kind: "answer",
		sdp: "s",
	});
	expect(parseDeviceMessage(JSON.stringify({ kind: "bye" }))).toEqual({ kind: "bye" });
});

test("parseHostMessage accepts valid host frames", () => {
	expect(parseHostMessage(JSON.stringify({ kind: "challenge", challenge: "c" }))).toEqual({
		kind: "challenge",
		challenge: "c",
	});
	expect(parseHostMessage(JSON.stringify({ kind: "accepted" }))).toEqual({ kind: "accepted" });
	expect(parseHostMessage(JSON.stringify({ kind: "offer", sdp: "o" }))).toEqual({
		kind: "offer",
		sdp: "o",
	});
	expect(parseHostMessage(JSON.stringify({ kind: "rejected", reason: "no" }))).toEqual({
		kind: "rejected",
		reason: "no",
	});
});

test("both parsers reject bad json, unknown kinds, missing fields, and empty labels", () => {
	expect(parseDeviceMessage("not json")).toBeNull();
	expect(parseDeviceMessage(JSON.stringify({ kind: "proof" }))).toBeNull();
	expect(
		parseDeviceMessage(
			JSON.stringify({ kind: "hello", token: "t", devicePublicKey: "k", label: "  " }),
		),
	).toBeNull();
	expect(parseHostMessage(JSON.stringify({ kind: "challenge" }))).toBeNull();
	expect(parseHostMessage(JSON.stringify({ kind: "nope" }))).toBeNull();
});

test("encoders round-trip", () => {
	const host: HostMessage = { kind: "challenge", challenge: "c" };
	const device: DeviceMessage = { kind: "proof", signature: "s" };
	expect(JSON.parse(encodeHostMessage(host))).toEqual(host);
	expect(JSON.parse(encodeDeviceMessage(device))).toEqual(device);
});
