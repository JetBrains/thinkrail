import { expect, test } from "bun:test";
import {
	isSpeechModel,
	parseSpeechClientMessage,
	parseSpeechServerMessage,
	SPEECH_SAMPLE_RATE,
	SPEECH_SOCKET_ROUTE,
} from "./speech";

test("the speech socket streams 16 kHz PCM16 on /speech", () => {
	expect(SPEECH_SOCKET_ROUTE).toBe("/speech");
	expect(SPEECH_SAMPLE_RATE).toBe(16_000);
	expect(isSpeechModel("multilingual")).toBe(true);
	expect(isSpeechModel("english")).toBe(true);
	expect(isSpeechModel("klingon")).toBe(false);
});

test("server messages parse only their closed shapes", () => {
	expect(parseSpeechServerMessage('{"type":"ready"}')).toEqual({ type: "ready" });
	expect(parseSpeechServerMessage('{"type":"partial","text":"hel"}')).toEqual({
		type: "partial",
		text: "hel",
	});
	expect(parseSpeechServerMessage('{"type":"final","text":"Hello."}')).toEqual({
		type: "final",
		text: "Hello.",
	});
	expect(parseSpeechServerMessage('{"type":"error","code":"SPEECH_BUSY"}')).toEqual({
		type: "error",
		code: "SPEECH_BUSY",
	});
	expect(parseSpeechServerMessage('{"type":"error","code":"NOPE"}')).toBeNull();
	expect(parseSpeechServerMessage('{"type":"partial"}')).toBeNull();
	expect(parseSpeechServerMessage("not json")).toBeNull();
	expect(parseSpeechServerMessage(new ArrayBuffer(2))).toBeNull();
});

test("client messages carry optional string scope only", () => {
	expect(parseSpeechClientMessage('{"type":"start","workspaceId":"w","sessionId":"s"}')).toEqual({
		type: "start",
		workspaceId: "w",
		sessionId: "s",
	});
	expect(parseSpeechClientMessage('{"type":"start"}')).toEqual({ type: "start" });
	expect(parseSpeechClientMessage('{"type":"stop"}')).toEqual({ type: "stop" });
	expect(parseSpeechClientMessage('{"type":"start","workspaceId":1}')).toBeNull();
	expect(parseSpeechClientMessage('{"type":"begin"}')).toBeNull();
	expect(parseSpeechClientMessage("[")).toBeNull();
});
